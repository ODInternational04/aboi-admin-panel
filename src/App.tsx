import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2
} from 'lucide-react';
import {
  ApiError,
  adminApi,
  authApi,
  currencyApi,
  publicApi,
  type AdminCommodity,
  type CategoryOption,
  type AdminUser,
  type DashboardSummary,
  type PriceUpdateRun,
  type CurrentPriceSnapshot
} from './services/api';
import './App.css';
import logo from './assets/logo.png';

type Status = 'checking' | 'login' | 'ready';

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

type Drafts = Record<string, {
  min: string;
  max: string;
  price: string;
}>;

type PendingAction = {
  type: 'range' | 'price' | 'refresh' | 'randomize' | 'manage_save' | 'manage_delete' | 'manage_create' | null;
  id?: string;
};

type ManageDraft = {
  name: string;
  symbol: string;
  category_id: string;
  unit: string;
  description: string;
  is_active: boolean;
};

type ViewMode = 'dashboard' | 'manage';

const makeManageDraft = (commodity?: Partial<AdminCommodity>, fallbackCategoryId = ''): ManageDraft => ({
  name: commodity?.name ?? '',
  symbol: commodity?.symbol ?? '',
  category_id: commodity?.category_id ?? fallbackCategoryId,
  unit: commodity?.unit ?? '',
  description: commodity?.description ?? '',
  is_active: commodity?.is_active ?? true
});

const defaultLogin = {
  email: import.meta.env.VITE_ADMIN_DEFAULT_EMAIL ?? '',
  password: ''
};

const formatCurrency = (value?: number | string | null, currency: 'USD' | 'ZAR' = 'USD') => {
  if (value === null || value === undefined) {
    return '—';
  }

  let numericSource: number | string = value;

  if (typeof numericSource === 'string') {
    const cleaned = numericSource
      .replace(/[\s\$Rr]/g, '')
      .replace(/,/g, '')
      .replace(/[^0-9.+-]/g, '');
    numericSource = cleaned;
  }

  const numericValue = typeof numericSource === 'string'
    ? Number.parseFloat(numericSource)
    : Number(numericSource);

  if (!Number.isFinite(numericValue)) {
    return '—';
  }

  const symbol = currency === 'USD' ? '$' : 'R';
  const minimumDecimals = 2;
  const maximumDecimals = currency === 'USD' ? 4 : 2;

  let formatted = numericValue.toFixed(maximumDecimals);
  formatted = formatted
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '')
    .replace(/\.$/, '');

  if (!formatted.includes('.')) {
    formatted = `${formatted}.${'0'.repeat(minimumDecimals)}`;
  } else {
    const fractionLength = formatted.length - formatted.indexOf('.') - 1;
    if (fractionLength < minimumDecimals) {
      formatted = `${formatted}${'0'.repeat(minimumDecimals - fractionLength)}`;
    }
  }

  return `${symbol} ${formatted}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Never';
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const humanize = (value?: string | null) => {
  if (!value) {
    return 'Unknown';
  }
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const App: React.FC = () => {
  const [status, setStatus] = useState<Status>('checking');
  const [view, setView] = useState<ViewMode>('dashboard');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [commodities, setCommodities] = useState<AdminCommodity[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [manageDrafts, setManageDrafts] = useState<Record<string, ManageDraft>>({});
  const [newCommodity, setNewCommodity] = useState<ManageDraft>(() => makeManageDraft());
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>({ type: null });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loginForm, setLoginForm] = useState(defaultLogin);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [priceRuns, setPriceRuns] = useState<PriceUpdateRun[]>([]);
  const [usdToZarRate, setUsdToZarRate] = useState<number | null>(null);
  const [zarToUsdRate, setZarToUsdRate] = useState<number | null>(null);

  const activeCount = useMemo(
    () => commodities.filter((item) => item.is_active).length,
    [commodities]
  );

  const setDraftValues = useCallback((items: AdminCommodity[], options?: { usdToZar?: number; zarToUsd?: number }) => {
    const resolvedUsdToZar = options?.usdToZar;
    const resolvedZarToUsd = options?.zarToUsd ?? (resolvedUsdToZar ? 1 / resolvedUsdToZar : undefined);

    setDrafts(() => {
      const next: Drafts = {};
      items.forEach((item) => {
        const minUsd = item.min_price_usd ?? (resolvedZarToUsd && item.min_price_zar !== undefined && item.min_price_zar !== null
          ? Number(item.min_price_zar) * resolvedZarToUsd
          : undefined);
        const maxUsd = item.max_price_usd ?? (resolvedZarToUsd && item.max_price_zar !== undefined && item.max_price_zar !== null
          ? Number(item.max_price_zar) * resolvedZarToUsd
          : undefined);
        const currentUsd = item.current_price_usd ?? (resolvedZarToUsd && item.current_price_zar !== undefined && item.current_price_zar !== null
          ? Number(item.current_price_zar) * resolvedZarToUsd
          : undefined);

        next[item.id] = {
          min: minUsd !== undefined && Number.isFinite(minUsd) ? minUsd.toFixed(4) : '',
          max: maxUsd !== undefined && Number.isFinite(maxUsd) ? maxUsd.toFixed(4) : '',
          price: currentUsd !== undefined && Number.isFinite(currentUsd) ? currentUsd.toFixed(4) : ''
        };
      });
      return next;
    });

    setManageDrafts(() => {
      const next: Record<string, ManageDraft> = {};
      items.forEach((item) => {
        next[item.id] = makeManageDraft(item);
      });
      return next;
    });
  }, []);

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const [commoditiesData, summaryData, runsData, livePrices, usdRates] = await Promise.all([
        adminApi.getCommodities(),
        adminApi.getDashboardSummary().catch((error) => {
          if (error instanceof ApiError && error.status === 401) {
            throw error;
          }
          console.warn('Failed to load dashboard summary', error);
          return null;
        }),
        adminApi.getPriceUpdateRuns(10).catch((error) => {
          if (error instanceof ApiError && error.status === 401) {
            throw error;
          }
          console.warn('Failed to load price update history', error);
          return [];
        }),
        publicApi.getCurrentPrices('both').catch((error) => {
          console.warn('Failed to load live prices', error);
          return [] as CurrentPriceSnapshot[];
        }),
        currencyApi.getRates('USD', ['ZAR']).catch((error) => {
          console.warn('Failed to load USD→ZAR rate', error);
          return {} as Record<string, number>;
        })
      ]);

      const ordered = [...commoditiesData].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
      const priceIndex = new Map(livePrices.map((price) => [price.commodity_id, price]));

      const enriched = ordered.map((commodity) => {
        const snapshot = priceIndex.get(commodity.id);
        if (!snapshot) {
          return commodity;
        }

        return {
          ...commodity,
          current_price_zar: snapshot.price_zar ?? commodity.current_price_zar ?? null,
          current_price_usd: snapshot.price_usd ?? commodity.current_price_usd ?? null,
          change_24h_percent: snapshot.change_24h_percent ?? commodity.change_24h_percent ?? null,
          exchange_rate: snapshot.exchange_rate ?? commodity.exchange_rate ?? null,
          last_updated: snapshot.last_updated ?? commodity.last_updated ?? null
        } satisfies AdminCommodity;
      });

      const resolvedUsdToZar = typeof usdRates?.ZAR === 'number' ? usdRates.ZAR : null;
      if (resolvedUsdToZar !== null) {
        setUsdToZarRate(resolvedUsdToZar);
        setZarToUsdRate(1 / resolvedUsdToZar);
      }

      setCommodities(enriched);
      const summaryZarToUsd = summaryData?.latest_exchange_rate?.rate;
      const derivedUsdToZar = resolvedUsdToZar ?? (summaryZarToUsd ? 1 / summaryZarToUsd : undefined);
      const derivedZarToUsd = summaryZarToUsd ?? (resolvedUsdToZar ? 1 / resolvedUsdToZar : undefined);

      if (summaryZarToUsd) {
        setZarToUsdRate(summaryZarToUsd);
        if (resolvedUsdToZar === null && derivedUsdToZar) {
          setUsdToZarRate(derivedUsdToZar);
        }
      }

      setDraftValues(enriched, {
        usdToZar: derivedUsdToZar,
        zarToUsd: derivedZarToUsd
      });
      setSummary(summaryData);
      setPriceRuns(runsData ?? []);
      setLastSyncedAt(new Date());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setFeedback({ type: 'error', message: 'Session expired. Please sign in again.' });
        setUser(null);
        setStatus('login');
        setSummary(null);
        setPriceRuns([]);
        setCommodities([]);
        setDrafts({});
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to load admin data.';
      setFeedback({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [setDraftValues]);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const currentUser = await authApi.me();
        if (!active) {
          return;
        }

        if (currentUser) {
          setUser(currentUser);
          setStatus('ready');
          await hydrate();
        } else {
          setStatus('login');
        }
      } catch (error) {
        if (!active) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Session expired. Please sign in again.';
        setFeedback({ type: 'error', message });
        setStatus('login');
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (!feedback) {
      return;
    }
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    let active = true;

    const loadCategories = async () => {
      try {
        const categoryData = await publicApi.getCategories();
        if (!active) {
          return;
        }
        setCategories(categoryData);
      } catch (error) {
        console.warn('Failed to load categories', error);
      }
    };

    void loadCategories();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setNewCommodity((prev) => {
      const fallbackId = categories[0]?.id ?? '';

      if (prev.category_id && categories.some((category) => category.id === prev.category_id)) {
        return prev;
      }

      if (!fallbackId || prev.category_id === fallbackId) {
        return prev;
      }

      return {
        ...prev,
        category_id: fallbackId
      };
    });
  }, [categories]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setPendingAction({ type: 'refresh' });
      const { user: currentUser } = await authApi.login(loginForm.email.trim(), loginForm.password);
      setUser(currentUser);
      setStatus('ready');
      setFeedback({ type: 'success', message: 'Signed in successfully.' });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed. Check your credentials and try again.';
      setFeedback({ type: 'error', message });
      setStatus('login');
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to end session cleanly.';
      setFeedback({ type: 'error', message });
    }
    setUser(null);
    setStatus('login');
    setCommodities([]);
    setDrafts({});
    setSummary(null);
    setPriceRuns([]);
  };

  const handleDraftChange = (id: string, field: keyof Drafts[string], value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        min: prev[id]?.min ?? '',
        max: prev[id]?.max ?? '',
        price: prev[id]?.price ?? '',
        [field]: value
      }
    }));
  };

  const getUsdToZarForCommodity = useCallback((commodity?: AdminCommodity | null) => {
    if (typeof usdToZarRate === 'number' && Number.isFinite(usdToZarRate) && usdToZarRate > 0) {
      return usdToZarRate;
    }

    if (typeof zarToUsdRate === 'number' && Number.isFinite(zarToUsdRate) && zarToUsdRate > 0) {
      return 1 / zarToUsdRate;
    }

    const exchange = commodity?.exchange_rate;
    if (typeof exchange === 'number' && Number.isFinite(exchange) && exchange > 0) {
      return 1 / exchange;
    }

    return null;
  }, [usdToZarRate, zarToUsdRate]);

  const formatUsdToZar = useCallback((valueUsd?: number | null, commodity?: AdminCommodity | null) => {
    if (valueUsd === undefined || valueUsd === null) {
      return null;
    }

    const rate = getUsdToZarForCommodity(commodity);
    if (!rate) {
      return null;
    }

    const converted = valueUsd * rate;
    return formatCurrency(converted, 'ZAR');
  }, [getUsdToZarForCommodity]);

  const formatZarValue = useCallback((
    valueZar?: number | string | null,
    fallbackUsd?: number | null,
    commodity?: AdminCommodity | null
  ) => {
    if (valueZar !== undefined && valueZar !== null) {
      const numeric = typeof valueZar === 'string'
        ? Number.parseFloat(valueZar)
        : Number(valueZar);

      if (Number.isFinite(numeric)) {
        return formatCurrency(numeric, 'ZAR');
      }
    }

    return formatUsdToZar(fallbackUsd, commodity);
  }, [formatUsdToZar]);

  const handleSaveRange = async (id: string) => {
    const draft = drafts[id];
    if (!draft) {
      return;
    }

    const min = Number(draft.min);
    const max = Number(draft.max);

    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      setFeedback({ type: 'error', message: 'Enter valid minimum and maximum values.' });
      return;
    }

    if (min >= max) {
      setFeedback({ type: 'error', message: 'Minimum must be lower than maximum.' });
      return;
    }

    setPendingAction({ type: 'range', id });
    try {
      await adminApi.updatePriceRange(id, {
        min_price_usd: min,
        max_price_usd: max
      });
      setFeedback({ type: 'success', message: 'Price range updated.' });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update price range.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleSavePrice = async (id: string) => {
    const draft = drafts[id];
    if (!draft) {
      return;
    }

    const price = Number(draft.price);

    if (!Number.isFinite(price) || price <= 0) {
      setFeedback({ type: 'error', message: 'Enter a valid price greater than zero.' });
      return;
    }

    setPendingAction({ type: 'price', id });
    try {
      await adminApi.updateCommodityPrice(id, { price_usd: price });
      setFeedback({ type: 'success', message: 'Spot price updated.' });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update price.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleRefresh = async () => {
    setPendingAction({ type: 'refresh' });
    await hydrate();
    setPendingAction({ type: null });
  };

  const handleRandomizeAll = async () => {
    setPendingAction({ type: 'randomize' });
    try {
      const result = await adminApi.triggerPriceUpdate();
      const updated = typeof result?.updated === 'number' ? result.updated : null;
      const total = typeof result?.total === 'number' ? result.total : null;
      const skipped = Array.isArray(result?.skipped) ? result?.skipped : [];
      const failures = Array.isArray(result?.failures) ? result?.failures : [];

      if (skipped.length > 0 || failures.length > 0) {
        console.group('Price update diagnostics');
        if (skipped.length > 0) {
          console.warn('Skipped commodities (missing ranges):', skipped);
        }
        if (failures.length > 0) {
          console.error('Failed commodities (Supabase errors):', failures);
        }
        console.groupEnd();
      }

      let message = 'Triggered price randomisation.';
      if (updated !== null && total !== null) {
        message = `Randomised ${updated}/${total} commodities.`;
        if (updated === 0 && (skipped.length > 0 || failures.length > 0)) {
          const skippedSummary = skipped.length > 0
            ? `${skipped.length} missing price range`
            : null;
          const failureSummary = failures.length > 0
            ? `${failures.length} update error`
            : null;
          const reason = [skippedSummary, failureSummary]
            .filter(Boolean)
            .join(', ');
          message = `Randomised ${updated}/${total} commodities. Check console: ${reason}.`;
        }
      }

      setFeedback({ type: 'success', message });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to randomise prices.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleManageDraftChange = (id: string, field: keyof ManageDraft, value: string | boolean) => {
    setManageDrafts((prev) => {
      const current = prev[id] ?? makeManageDraft();
      return {
        ...prev,
        [id]: {
          ...current,
          [field]: field === 'is_active' ? Boolean(value) : String(value)
        }
      };
    });
  };

  const handleNewCommodityChange = (field: keyof ManageDraft, value: string | boolean) => {
    setNewCommodity((prev) => ({
      ...prev,
      [field]: field === 'is_active' ? Boolean(value) : String(value)
    }));
  };

  const handleSaveCommodityDetails = async (id: string) => {
    const draft = manageDrafts[id];
    if (!draft) {
      return;
    }

    const name = draft.name.trim();
    const symbol = draft.symbol.trim();
    const categoryId = draft.category_id.trim();

    if (!name) {
      setFeedback({ type: 'error', message: 'Name is required.' });
      return;
    }

    if (!symbol) {
      setFeedback({ type: 'error', message: 'Symbol is required.' });
      return;
    }

    if (!categoryId) {
      setFeedback({ type: 'error', message: 'Choose a category before saving.' });
      return;
    }

    setPendingAction({ type: 'manage_save', id });
    try {
      await adminApi.updateCommodity(id, {
        name,
        symbol: symbol.toUpperCase(),
        category_id: categoryId,
        unit: draft.unit.trim() || null,
        description: draft.description.trim() || null,
        is_active: draft.is_active
      });
      setFeedback({ type: 'success', message: `${name} updated.` });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update commodity.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleDeleteCommodity = async (id: string) => {
    const draft = manageDrafts[id] ?? makeManageDraft();
    const label = draft.name || 'Commodity';

    if (!window.confirm(`Delete ${label}? This action cannot be undone.`)) {
      return;
    }

    setPendingAction({ type: 'manage_delete', id });
    try {
      await adminApi.deleteCommodity(id);
      setFeedback({ type: 'success', message: `${label} deleted.` });
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete commodity.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const handleCreateCommodity = async () => {
    const name = newCommodity.name.trim();
    const symbol = newCommodity.symbol.trim();
    const categoryId = newCommodity.category_id.trim();

    if (!name || !symbol || !categoryId) {
      setFeedback({ type: 'error', message: 'Name, symbol, and category are required to create a commodity.' });
      return;
    }

    setPendingAction({ type: 'manage_create' });
    try {
      await adminApi.createCommodity({
        name,
        symbol: symbol.toUpperCase(),
        category_id: categoryId,
        unit: newCommodity.unit.trim() || null,
        description: newCommodity.description.trim() || null,
        is_active: newCommodity.is_active
      });
      setFeedback({ type: 'success', message: `${name} added.` });
      setNewCommodity(makeManageDraft(undefined, categories[0]?.id ?? ''));
      await hydrate();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add commodity.';
      setFeedback({ type: 'error', message });
    } finally {
      setPendingAction({ type: null });
    }
  };

  const isActionPending = (type: PendingAction['type'], id?: string) =>
    pendingAction.type === type && (id === undefined || pendingAction.id === id);

  if (status === 'checking') {
    return (
      <div className="page-loader">
        <RefreshCw className="page-loader__icon" />
        <span>Preparing admin console…</span>
      </div>
    );
  }

  if (status === 'login') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-card__header">
            <img src={logo} alt="Green Oil Index logo" className="auth-card__logo" />
            <h1>Green Oil Index [Admin]</h1>
            <p>Sign in to adjust index ranges and spot prices.</p>
          </div>
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="form-field">
              <span>Email address</span>
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                placeholder="••••••••"
                required
              />
            </label>
            <button type="submit" className="btn btn--primary" disabled={isActionPending('refresh')}>
              {isActionPending('refresh') && <RefreshCw className="btn__icon btn__icon--spin" />}
              <span>Sign in</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div className="admin-header__inner">
          <div className="admin-brand">
            <img src={logo} alt="Green Oil Index logo" className="admin-brand__logo" />
            <div className="admin-brand__copy">
              <span className="admin-brand__title">Green Oil Index [Admin]</span>
              <span className="admin-brand__subtitle">Manage price ranges for the public feed</span>
            </div>
          </div>
          <div className="admin-header__actions">
            <button
              type="button"
              className={`btn ${view === 'manage' ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => setView((current) => (current === 'manage' ? 'dashboard' : 'manage'))}
              aria-pressed={view === 'manage'}
            >
              {view === 'manage' ? <ArrowLeft className="btn__icon" /> : <Settings className="btn__icon" />}
              <span>{view === 'manage' ? 'Back to dashboard' : 'Manage catalogue'}</span>
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleRandomizeAll()}
              disabled={loading || isActionPending('randomize') || isActionPending('refresh')}
            >
              {isActionPending('randomize') ? (
                <RefreshCw className="btn__icon btn__icon--spin" />
              ) : (
                <Sparkles className="btn__icon" />
              )}
              <span>Randomise all</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void handleRefresh()}
              disabled={loading || isActionPending('refresh')}
            >
              <RefreshCw className={`btn__icon ${loading || isActionPending('refresh') ? 'btn__icon--spin' : ''}`} />
              <span>Sync data</span>
            </button>
            {user && (
              <div className="admin-header__user">
                <span className="admin-header__welcome">Signed in as</span>
                <strong>{user.username ?? user.email}</strong>
              </div>
            )}
            <button type="button" className="btn btn--danger" onClick={handleLogout} disabled={!user}>
              <LogOut className="btn__icon" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="admin-content">
        {feedback && (
          <div className={`alert alert--${feedback.type}`}>
            {feedback.type === 'success' ? (
              <CheckCircle2 className="alert__icon" />
            ) : (
              <AlertCircle className="alert__icon" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {view === 'dashboard' ? (
          <>
            <section className="stats-row">
              <div className="stat-card">
                <span className="stat-card__label">Active commodities</span>
                <span className="stat-card__value">{summary?.active_commodities ?? activeCount}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Total commodities</span>
                <span className="stat-card__value">{summary?.total_commodities ?? commodities.length}</span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Last auto update</span>
                <span className="stat-card__value stat-card__value--smaller">
                  {summary?.last_price_run ? `${formatDateTime(summary.last_price_run.executed_at)}` : '—'}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-card__label">Latest FX (ZAR → USD)</span>
                <span className="stat-card__value stat-card__value--smaller">
                  {summary?.latest_exchange_rate
                    ? `${summary.latest_exchange_rate.rate.toFixed(4)} (${formatDateTime(summary.latest_exchange_rate.recorded_at)})`
                    : '—'}
                </span>
              </div>
            </section>

            <section className="dashboard-grid">
              <section className="panel panel--commodity">
                <div className="panel__header">
                  <div>
                    <h2>Commodity price bands</h2>
                    <p>Update daily trading ranges and override spot prices for each commodity.</p>
                  </div>
                  <span className={`sync-indicator ${loading ? 'sync-indicator--active' : ''}`}>
                    <RefreshCw
                      className={`sync-indicator__icon ${loading ? 'sync-indicator__icon--spin' : ''}`}
                      size={16}
                    />
                    <span className="sync-indicator__time">
                      {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : '—'}
                    </span>
                  </span>
                </div>

                <div className="commodity-grid">
                  {commodities.map((commodity) => {
                    const draft = drafts[commodity.id] ?? { min: '', max: '', price: '' };
                    const rangePending = isActionPending('range', commodity.id);
                    const pricePending = isActionPending('price', commodity.id);
                    const currentPriceUsdDisplay = formatCurrency(commodity.current_price_usd, 'USD');
                    const currentPriceZarDisplay = formatZarValue(
                      commodity.current_price_zar,
                      commodity.current_price_usd,
                      commodity
                    );
                    const rangeMinUsdDisplay = formatCurrency(commodity.min_price_usd, 'USD');
                    const rangeMaxUsdDisplay = formatCurrency(commodity.max_price_usd, 'USD');
                    const rangeMinZarDisplay = formatZarValue(
                      commodity.min_price_zar,
                      commodity.min_price_usd,
                      commodity
                    );
                    const rangeMaxZarDisplay = formatZarValue(
                      commodity.max_price_zar,
                      commodity.max_price_usd,
                      commodity
                    );
                    const showCurrentZar = Boolean(currentPriceZarDisplay && currentPriceZarDisplay !== '—');
                    const showRangeApprox = Boolean(
                      rangeMinZarDisplay && rangeMaxZarDisplay &&
                      rangeMinZarDisplay !== '—' && rangeMaxZarDisplay !== '—'
                    );

                    return (
                      <article
                        key={commodity.id}
                        className={`commodity-card ${commodity.is_active ? '' : 'commodity-card--inactive'}`}
                      >
                        <header className="commodity-card__header">
                          <div>
                            <h3>{commodity.name}</h3>
                            <span className="commodity-card__symbol">{commodity.symbol}</span>
                          </div>
                          <span className={`badge ${commodity.is_active ? 'badge--success' : 'badge--muted'}`}>
                            {commodity.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </header>

                        <div className="commodity-card__meta">
                          <span>{commodity.category_name ?? 'Uncategorised'}</span>
                          <span>Last update: {formatDateTime(commodity.last_updated)}</span>
                        </div>

                        <div className="commodity-card__prices">
                          <div className="price-tile">
                            <span className="price-tile__label">Current price (USD)</span>
                            <span className="price-tile__value">{currentPriceUsdDisplay}</span>
                            {showCurrentZar ? (
                              <span className="price-tile__hint">≈ {currentPriceZarDisplay}</span>
                            ) : null}
                          </div>
                          <div className="price-tile">
                            <span className="price-tile__label">Range (USD)</span>
                            <span className="price-tile__value">
                              {rangeMinUsdDisplay} – {rangeMaxUsdDisplay}
                            </span>
                            {showRangeApprox ? (
                              <span className="price-tile__hint">≈ {rangeMinZarDisplay} – {rangeMaxZarDisplay}</span>
                            ) : null}
                          </div>
                        </div>

                        <form
                          className="inline-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleSaveRange(commodity.id);
                          }}
                        >
                          <div className="form-field">
                            <span>Minimum (USD)</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.0001"
                              value={draft.min}
                              onChange={(event) => handleDraftChange(commodity.id, 'min', event.target.value)}
                              placeholder="0.00"
                            />
                          </div>
                          <div className="form-field">
                            <span>Maximum (USD)</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.0001"
                              value={draft.max}
                              onChange={(event) => handleDraftChange(commodity.id, 'max', event.target.value)}
                              placeholder="0.00"
                            />
                          </div>
                          <button type="submit" className="btn btn--primary" disabled={rangePending}>
                            {rangePending && <RefreshCw className="btn__icon btn__icon--spin" />}
                            <span>Save range</span>
                          </button>
                        </form>

                        <form
                          className="inline-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleSavePrice(commodity.id);
                          }}
                        >
                          <div className="form-field">
                            <span>Manual spot price (USD)</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.0001"
                              value={draft.price}
                              onChange={(event) => handleDraftChange(commodity.id, 'price', event.target.value)}
                              placeholder="0.00"
                            />
                          </div>
                          <button type="submit" className="btn btn--secondary" disabled={pricePending}>
                            {pricePending && <RefreshCw className="btn__icon btn__icon--spin" />}
                            <span>Update spot price</span>
                          </button>
                        </form>
                      </article>
                    );
                  })}
                </div>

                {commodities.length === 0 && !loading && (
                  <div className="empty-state">
                    <p>No commodities found. Add records in the dashboard to begin managing ranges.</p>
                  </div>
                )}
              </section>

              <section className="panel panel--runs">
                <div className="panel__header">
                  <div>
                    <h2>Recent price update runs</h2>
                    <p>Track automated and manual refresh jobs applied to the public feed.</p>
                  </div>
                </div>

                <div className="runs-list">
                  {priceRuns.length === 0 ? (
                    <p className="runs-list__empty">
                      Manual and scheduled price updates will appear here once they complete.
                    </p>
                  ) : (
                    priceRuns.map((run) => {
                      const updatedCount = run.updated_commodities ?? 0;
                      const totalCount = run.total_commodities ?? 0;
                      const statusKey = (run.status ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');

                      return (
                        <div key={run.id} className="runs-list__item">
                          <div className="runs-list__primary">
                            <strong>{formatDateTime(run.executed_at)}</strong>
                            <span className="runs-list__meta">Source: {humanize(run.trigger_source)}</span>
                          </div>
                          <div className="runs-list__details">
                            <span>{updatedCount}/{totalCount} commodities updated</span>
                            <span className={`runs-list__status runs-list__status--${statusKey}`}>
                              {humanize(run.status)}
                            </span>
                          </div>
                          {run.triggered_by_user && (
                            <div className="runs-list__meta runs-list__meta--small">
                              Triggered by {run.triggered_by_user.username ?? run.triggered_by_user.email}
                            </div>
                          )}
                          {run.notes && (
                            <div className="runs-list__meta runs-list__meta--small">{run.notes}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            </section>
          </>
        ) : (
          <section className="panel panel--manage">
            <div className="panel__header">
              <div>
                <h2>Commodity catalogue</h2>
                <p>Keep the underlying list aligned with what the client webapp displays.</p>
              </div>
              <span className={`sync-indicator ${loading ? 'sync-indicator--active' : ''}`}>
                <RefreshCw
                  className={`sync-indicator__icon ${loading ? 'sync-indicator__icon--spin' : ''}`}
                  size={16}
                />
                <span className="sync-indicator__time">
                  {lastSyncedAt ? lastSyncedAt.toLocaleTimeString() : '—'}
                </span>
              </span>
            </div>

            <form
              className="manage-form manage-form--create"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateCommodity();
              }}
            >
              <div className="manage-form__grid">
                <label className="form-field manage-field">
                  <span>Name</span>
                  <input
                    value={newCommodity.name}
                    onChange={(event) => handleNewCommodityChange('name', event.target.value)}
                    placeholder="e.g. Gold 1oz"
                    required
                  />
                </label>
                <label className="form-field manage-field">
                  <span>Symbol</span>
                  <input
                    value={newCommodity.symbol}
                    onChange={(event) => handleNewCommodityChange('symbol', event.target.value.toUpperCase())}
                    placeholder="XAU"
                    required
                  />
                </label>
                <label className="form-field manage-field">
                  <span>Category</span>
                  <select
                    value={newCommodity.category_id}
                    onChange={(event) => handleNewCommodityChange('category_id', event.target.value)}
                    required
                    disabled={categories.length === 0}
                  >
                    <option value="" disabled={categories.length > 0}>Select category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field manage-field">
                  <span>Unit</span>
                  <input
                    value={newCommodity.unit}
                    onChange={(event) => handleNewCommodityChange('unit', event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label className="form-field manage-field manage-field--wide">
                  <span>Description</span>
                  <input
                    value={newCommodity.description}
                    onChange={(event) => handleNewCommodityChange('description', event.target.value)}
                    placeholder="Optional context shown to admins"
                  />
                </label>
                <label className="form-field manage-field manage-field--toggle">
                  <span>Status</span>
                  <div className="toggle-control">
                    <input
                      type="checkbox"
                      checked={newCommodity.is_active}
                      onChange={(event) => handleNewCommodityChange('is_active', event.target.checked)}
                    />
                    <span>{newCommodity.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                </label>
              </div>
              <div className="manage-form__actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={isActionPending('manage_create') || categories.length === 0}
                >
                  {isActionPending('manage_create') ? (
                    <RefreshCw className="btn__icon btn__icon--spin" />
                  ) : (
                    <Plus className="btn__icon" />
                  )}
                  <span>Add commodity</span>
                </button>
              </div>
              {categories.length === 0 && (
                <p className="manage-hint">Create a category in the backend before adding commodities.</p>
              )}
            </form>

            <div className="manage-list">
              {commodities.map((commodity) => {
                const draft = manageDrafts[commodity.id] ?? makeManageDraft(commodity, categories[0]?.id ?? '');
                const savePending = isActionPending('manage_save', commodity.id);
                const deletePending = isActionPending('manage_delete', commodity.id);

                return (
                  <form
                    key={commodity.id}
                    className="manage-row"
                    data-inactive={!draft.is_active}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveCommodityDetails(commodity.id);
                    }}
                  >
                    <div className="manage-row__grid">
                      <label className="form-field manage-field">
                        <span>Name</span>
                        <input
                          value={draft.name}
                          onChange={(event) => handleManageDraftChange(commodity.id, 'name', event.target.value)}
                          required
                        />
                      </label>
                      <label className="form-field manage-field">
                        <span>Symbol</span>
                        <input
                          value={draft.symbol}
                          onChange={(event) => handleManageDraftChange(commodity.id, 'symbol', event.target.value.toUpperCase())}
                          required
                        />
                      </label>
                      <label className="form-field manage-field">
                        <span>Category</span>
                        <select
                          value={draft.category_id}
                          onChange={(event) => handleManageDraftChange(commodity.id, 'category_id', event.target.value)}
                          required
                        >
                          <option value="" disabled>Select category</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field manage-field">
                        <span>Unit</span>
                        <input
                          value={draft.unit}
                          onChange={(event) => handleManageDraftChange(commodity.id, 'unit', event.target.value)}
                          placeholder="Optional"
                        />
                      </label>
                      <label className="form-field manage-field manage-field--wide">
                        <span>Description</span>
                        <input
                          value={draft.description}
                          onChange={(event) => handleManageDraftChange(commodity.id, 'description', event.target.value)}
                          placeholder="Optional notes"
                        />
                      </label>
                      <label className="form-field manage-field manage-field--toggle">
                        <span>Status</span>
                        <div className="toggle-control">
                          <input
                            type="checkbox"
                            checked={draft.is_active}
                            onChange={(event) => handleManageDraftChange(commodity.id, 'is_active', event.target.checked)}
                          />
                          <span>{draft.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                      </label>
                    </div>
                    <div className="manage-row__actions">
                      <button type="submit" className="btn btn--secondary" disabled={savePending || deletePending}>
                        {savePending ? <RefreshCw className="btn__icon btn__icon--spin" /> : <Check className="btn__icon" />}
                        <span>Save changes</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => void handleDeleteCommodity(commodity.id)}
                        disabled={deletePending || savePending}
                      >
                        {deletePending ? <RefreshCw className="btn__icon btn__icon--spin" /> : <Trash2 className="btn__icon" />}
                        <span>Delete</span>
                      </button>
                    </div>
                  </form>
                );
              })}

              {commodities.length === 0 && (
                <div className="empty-state">
                  <p>Use the form above to add your first commodity.</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
