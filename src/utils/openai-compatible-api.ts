import http from 'node:http'
import https from 'node:https'
import type { OpenAIModel, OpenAIModelsResponse } from '../types'

const OPENAI_COMPATIBLE_MODELS_ENDPOINT = "/v1/models"

export interface ModelsDiscoveryResult {
  ok: boolean
  models: OpenAIModel[]
}

export interface ModelInfoDiscoveryResult {
  ok: boolean
  data: unknown
}

export function normalizeBaseURL(baseURL: string): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

export function buildAPIURL(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

function fetchViaHttpModule(urlStr: string, apiKey?: string): Promise<ModelsDiscoveryResult> {
  return new Promise((resolve) => {
    const urlObj = new URL(urlStr)
    const mod = urlObj.protocol === 'https:' ? https : http
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
    const req = mod.get(urlObj, { headers, timeout: 5000 }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as OpenAIModelsResponse
          resolve({ ok: true, models: parsed.data ?? [] })
        } catch {
          resolve({ ok: false, models: [] })
        }
      })
      res.on('error', () => resolve({ ok: false, models: [] }))
    })
    req.on('error', () => resolve({ ok: false, models: [] }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, models: [] }) })
  })
}

export async function discoverModelsFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT
): Promise<ModelsDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  // Try fetch() first (works in most environments)
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = (await response.json()) as OpenAIModelsResponse
      if (data.data && data.data.length > 0) {
        return { ok: true, models: data.data }
      }
    }
  } catch {
    // fetch failed (e.g. undici timeout on some servers) — fall through to http module
  }

  // Fallback: use Node.js http/https module (more reliable with some servers like OmniRoute)
  return fetchViaHttpModule(url, apiKey)
}

export async function discoverModelInfoFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = "/v1/model/info"
): Promise<ModelInfoDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = await response.json()
      return { ok: true, data }
    }
  } catch {
    // fall through to http module fallback
  }

  return new Promise((resolve) => {
    const urlObj = new URL(url)
    const mod = urlObj.protocol === 'https:' ? https : http
    const req = mod.get(urlObj, { headers, timeout: 5000 }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => resolve({ ok: true, data: JSON.parse(data) }))
      res.on('error', () => resolve({ ok: false, data: undefined }))
    })
    req.on('error', () => resolve({ ok: false, data: undefined }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: undefined }) })
  })
}

export async function fetchModelsDirect(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): Promise<string[]> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers = { "Content-Type": "application/json" }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = (await response.json()) as OpenAIModelsResponse
      const ids = data.data?.map(model => model.id) || []
      if (ids.length > 0) return ids
    }
  } catch {
    // fall through to http module fallback
  }

  return new Promise((resolve) => {
    const urlObj = new URL(url)
    const mod = urlObj.protocol === 'https:' ? https : http
    const req = mod.get(urlObj, { headers, timeout: 5000 }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as OpenAIModelsResponse
          resolve(parsed.data?.map(model => model.id) || [])
        } catch {
          resolve([])
        }
      })
      res.on('error', () => resolve([]))
    })
    req.on('error', () => resolve([]))
    req.on('timeout', () => { req.destroy(); resolve([]) })
  })
}

export async function autoDetectOpenAICompatibleProvider(): Promise<{ name: string; baseURL: string } | null> {
  const candidates = [
    { name: "LM Studio", ports: [1234, 8080, 11434] },
    { name: "Ollama", ports: [11434] },
    { name: "LocalAI", ports: [8080] },
  ]

  for (const candidate of candidates) {
    for (const port of candidate.ports) {
      const baseURL = `http://127.0.0.1:${port}`
      const discovery = await discoverModelsFromProvider(baseURL)
      if (discovery.ok) {
        return { name: candidate.name, baseURL }
      }
    }
  }
  return null
}

export function isOpenAICompatibleProvider(provider: any): boolean {
  return provider &&
         typeof provider === 'object' &&
         provider.npm === "@ai-sdk/openai-compatible"
}

export function hasOpenAICompatibleURL(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const baseURL = provider.options?.baseURL || ""
  return /\/v1(\/|$)/.test(baseURL)
}

export function hasModelsDiscoveryEndpoint(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const endpoint = provider.options?.modelsDiscovery?.endpoint
  return typeof endpoint === 'string' && endpoint.length > 0
}

export function canDiscoverModels(provider: any): boolean {
  return isOpenAICompatibleProvider(provider) || hasOpenAICompatibleURL(provider) || hasModelsDiscoveryEndpoint(provider)
}

export function isValidModel(model: any): model is { id: string; [key: string]: any } {
  return model &&
         typeof model === 'object' &&
         typeof model.id === 'string' &&
         model.id.length > 0
}
