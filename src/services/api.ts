const normaliseBaseUrl = (url: string) => url.replace(/\/$/, '');

const API_BASE_URL = normaliseBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
);

console.log('API_BASE_URL:', API_BASE_URL);
console.log('VITE_API_BASE_URL env:', import.meta.env.VITE_API_BASE_URL);

const TOKEN_STORAGE_KEY = 'aboi_admin_token';

let accessToken: string | null = null;

if (typeof window !== 'undefined') {
  accessToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

const persistToken = (token: string | null) => {
  accessToken = token;

  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

export class ApiError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
};

const resolveUrl = (path: string) =>
  `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== 'undefined' && value instanceof FormData;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true } = options;

  if (authenticated && !accessToken) {
    throw new ApiError('Not authenticated', 401);
  }

  const headers = new Headers({ Accept: 'application/json' });
  let fetchBody: BodyInit | undefined;

  if (body !== undefined && body !== null) {
    if (isFormData(body)) {
      fetchBody = body;
    } else if (typeof body === 'string') {
      headers.set('Content-Type', 'application/json');
      fetchBody = body;
    } else {
      headers.set('Content-Type', 'application/json');
      fetchBody = JSON.stringify(body);
    }
  }

  if (authenticated && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(resolveUrl(path), {
    method,
    headers,
    body: fetchBody,
  });

  let payload: unknown = null;

  if (response.status !== 204) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      payload = await response.text();
    }
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    if (isRecord(payload)) {
      const errorPayload = payload.error;
      if (isRecord(errorPayload) && typeof errorPayload.message === 'string') {
        message = errorPayload.message;
      } else if (typeof payload.message === 'string') {
        message = payload.message;
      }
    }

    if (response.status === 401 || response.status === 403) {
      persistToken(null);
    }

    throw new ApiError(message, response.status, payload);
  }

  if (isRecord(payload) && 'data' in payload) {
    return payload.data as T;
  }

  return payload as T;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  username?: string | null;
}

export interface AdminCommodity {
  id: string;
  name: string;
  symbol: string;
  description?: string | null;
  unit?: string | null;
  is_active: boolean;
  display_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  category_id: string;
  category_name?: string | null;
  min_price_zar?: number | null;
  max_price_zar?: number | null;
  min_price_usd?: number | null;
  max_price_usd?: number | null;
  range_active?: boolean | null;
  current_price_zar?: number | null;
  current_price_usd?: number | null;
  exchange_rate?: number | null;
  change_24h_percent?: number | null;
  last_updated?: string | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  description?: string | null;
  display_order?: number | null;
}

export interface DashboardSummary {
  total_commodities: number;
  active_commodities: number;
  total_categories: number;
  last_price_update: string | null;
  last_price_update_source: string | null;
  last_price_run: {
    executed_at: string;
    trigger_source: string | null;
    status: string | null;
    updated_commodities: number | null;
    total_commodities: number | null;
  } | null;
  latest_exchange_rate: {
    rate: number;
    recorded_at: string;
    source: string | null;
  } | null;
}

export interface PriceUpdateRun {
  id: string;
  executed_at: string;
  trigger_source: string | null;
  total_commodities: number;
  updated_commodities: number;
  status: string | null;
  notes?: string | null;
  triggered_by?: string | null;
  triggered_by_user?: {
    id: string;
    username?: string | null;
    email?: string | null;
  } | null;
}

export interface PriceUpdateSkipped {
  commodityId: string;
  reason?: string;
  minUsd?: number;
  maxUsd?: number;
  minZar?: number;
  maxZar?: number;
}

export interface PriceUpdateFailure {
  commodityId: string;
  symbol: string | null;
  message?: string | null;
  code?: string | null;
  details?: unknown;
  hint?: string | null;
}

export interface PriceUpdateResult {
  updated: number;
  total?: number;
  success?: boolean;
  skipped?: PriceUpdateSkipped[];
  failures?: PriceUpdateFailure[];
}

export interface CurrentPriceSnapshot {
  commodity_id: string;
  price_zar?: number | null;
  price_usd?: number | null;
  change_24h_percent?: number | null;
  exchange_rate?: number | null;
  last_updated?: string | null;
}

const authApi = {
  async login(email: string, password: string): Promise<{ token: string; user: AdminUser }> {
    const result = await request<{ token: string; user: AdminUser }>('/auth/login', {
      method: 'POST',
      body: {
        username: email,
        password,
      },
      authenticated: false,
    });

    persistToken(result.token);
    return result;
  },

  async me(): Promise<AdminUser | null> {
    if (!accessToken) {
      return null;
    }

    try {
      const result = await request<{ user: AdminUser }>('/auth/me');
      return result.user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },

  async logout(): Promise<void> {
    if (!accessToken) {
      return;
    }

    try {
      await request('/auth/logout', {
        method: 'POST',
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        throw error;
      }
    } finally {
      persistToken(null);
    }
  },
};

const adminApi = {
  async getCommodities(): Promise<AdminCommodity[]> {
    return request<AdminCommodity[]>('/admin/commodities');
  },

  async createCommodity(payload: {
    name: string;
    symbol: string;
    category_id: string;
    unit?: string | null;
    description?: string | null;
    is_active?: boolean;
  }): Promise<AdminCommodity> {
    return request<AdminCommodity>('/admin/commodities', {
      method: 'POST',
      body: payload,
    });
  },

  async updateCommodity(id: string, payload: Partial<AdminCommodity>): Promise<void> {
    await request(`/admin/commodities/${id}`, {
      method: 'PUT',
      body: payload,
    });
  },

  async deleteCommodity(id: string): Promise<void> {
    await request(`/admin/commodities/${id}`, {
      method: 'DELETE',
    });
  },

  async updatePriceRange(id: string, payload: {
    min_price_usd?: number;
    max_price_usd?: number;
    min_price_zar?: number;
    max_price_zar?: number;
  }): Promise<void> {
    await request(`/admin/commodities/${id}/price-range`, {
      method: 'PUT',
      body: payload,
    });
  },

  async updateCommodityPrice(id: string, payload: { price_usd?: number; price_zar?: number }): Promise<void> {
    await request(`/admin/commodities/${id}/price`, {
      method: 'PUT',
      body: payload,
    });
  },

  async triggerPriceUpdate(): Promise<PriceUpdateResult> {
    return request<PriceUpdateResult>('/admin/prices/update-all', {
      method: 'POST',
    });
  },

  async getDashboardSummary(): Promise<DashboardSummary> {
    return request<DashboardSummary>('/admin/dashboard/summary');
  },

  async getPriceUpdateRuns(limit = 20): Promise<PriceUpdateRun[]> {
    const searchParams = new URLSearchParams({ limit: String(limit) });
    return request<PriceUpdateRun[]>(`/admin/price-update-runs?${searchParams.toString()}`);
  },
};

const publicApi = {
  async getCategories(): Promise<CategoryOption[]> {
    return request<CategoryOption[]>('/commodities/categories', {
      authenticated: false,
    });
  },

  async getCurrentPrices(currency: 'zar' | 'usd' | 'both' = 'zar'): Promise<CurrentPriceSnapshot[]> {
    const searchParams = new URLSearchParams({ currency });
    return request<CurrentPriceSnapshot[]>(`/prices/current?${searchParams.toString()}`, {
      authenticated: false,
    });
  },
};

const currencyApi = {
  async getRates(base = 'USD', symbols: string[]): Promise<Record<string, number>> {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return {};
    }

    const params = new URLSearchParams({ base });
    params.set('symbols', symbols.join(','));

    const response = await request<{ base_currency: string; rates: Record<string, number> }>(
      `/currency/rates?${params.toString()}`,
      { authenticated: false }
    );

    return response.rates ?? {};
  }
};

export { adminApi, authApi, publicApi, currencyApi };
