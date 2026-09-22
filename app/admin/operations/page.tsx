'use client';

import { useRouter } from 'next/navigation';
import {
  productionRequest,
  ProductionRequestError as RequestError,
} from '@/lib/atlas/production-client';
import {
  allowedNextStatuses,
  canManageCase,
  caseKindLabels,
  caseServiceLabels,
  caseStatusLabels,
  serviceKinds,
  type AdminRole,
  type CaseKind,
  type CaseServiceType,
  type CaseStatus,
  type WarrantyStatus,
} from '@/lib/atlas/case-management';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  BarChart3,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FilePlus2,
  FileSearch,
  FileText,
  History,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RefreshCw,
  RotateCcwKey,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';

type Role = AdminRole;
type Membership = {
  organizationId: string;
  organizationName: string;
  role: Role;
  displayName: string | null;
};
type Admin = {
  userId: string;
  email: string;
  aal: 'aal1' | 'aal2';
  memberships: Membership[];
};
type Overview = {
  generated_at: string;
  period_days: number;
  cases: {
    total: number;
    open: number;
    overdue: number;
    without_eta: number;
    stale: number;
    resolved: number;
    avg_resolution_hours: number | null;
  };
  by_status: Record<string, number>;
  trend: { day: string; opened: number; closed: number }[];
  performance: {
    requests_24h: number;
    error_rate_24h: number | null;
    avg_latency_ms_24h: number | null;
    p95_latency_ms_24h: number | null;
    denied_24h: number;
    rate_limited_24h: number;
  };
  routes: {
    route: string;
    requests: number;
    errors: number;
    avg_ms: number | null;
  }[];
  documents: { total: number; published: number; review: number; expired: number };
  assistant: { messages_24h: number; conversations: number };
  handoffs: { open: number; unassigned: number };
};
type Priority = {
  id: string;
  reference: string;
  title: string;
  status: string;
  estimated_at: string | null;
  updated_at: string;
};
type Handoff = {
  id: string;
  case_id: string | null;
  reference: string | null;
  summary: string;
  status: string;
  assigned_to: string | null;
  updated_at: string;
  created_at: string;
};
type Queue = { priorities: Priority[]; handoffs: Handoff[] };
type AdminCase = {
  id: string;
  reference: string;
  service_type: CaseServiceType;
  kind: CaseKind;
  title: string;
  status: CaseStatus;
  warranty_status: WarrantyStatus;
  product: string | null;
  store: string | null;
  customer: string | null;
  estimated_at: string | null;
  updated_at: string;
  version: number;
  archived_at: string | null;
};
type CustomerSummary = {
  id: string;
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};
type ProductSummary = {
  id: string;
  external_id: string | null;
  sku: string | null;
  name: string;
  category: string | null;
  serial_number: string | null;
};
type CustomerLookup = CustomerSummary & {
  display_name: string;
  rank: number;
};
type ProductLookup = ProductSummary & {
  rank: number;
};
type StoreSummary = {
  id: string;
  code: string;
  name: string;
  city: string | null;
};
type CaseDetail = {
  id: string;
  reference: string;
  service_type: CaseServiceType;
  title: string;
  description: string;
  kind: CaseKind;
  status: CaseStatus;
  version: number;
  updated_at: string;
  estimated_at: string | null;
  created_at: string;
  closed_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  source_system: string | null;
  source_updated_at: string | null;
  warranty_status: WarrantyStatus;
  warranty_label: string | null;
  quote_cents: number | null;
  refund_cents: number | null;
  currency: string;
  delivery_mode: string | null;
  customer_id: string | null;
  customer: CustomerSummary | null;
  product_id: string | null;
  product: ProductSummary | null;
  store_id: string | null;
  store: StoreSummary | null;
  events: {
    id: string;
    label: string;
    detail: string | null;
    customer_visible: boolean;
    occurred_at: string;
    source: string;
  }[];
};
type Audit = {
  items: {
    id: string;
    action: string;
    outcome: string;
    entity_type: string | null;
    entity_id: string | null;
    actor_user_id: string | null;
    created_at: string;
  }[];
  total: number;
};
type CaseFormOptions = { stores: StoreSummary[] };
type AccessCodeResult = {
  ok: true;
  id: string;
  reference: string;
  version: number;
  access_code: string | null;
  access_code_available: boolean;
  replayed: boolean;
};
type MutationResult = {
  ok: true;
  id: string;
  reference: string;
  version: number;
};

type CaseListFilters = {
  search: string;
  service: '' | CaseServiceType;
  archive: 'active' | 'archived' | 'all';
};

type CreateDraft = {
  serviceType: CaseServiceType;
  kind: CaseKind;
  title: string;
  description: string;
  customerExternalId: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone: string;
  productExternalId: string;
  productSku: string;
  productName: string;
  productCategory: string;
  productSerialNumber: string;
  storeId: string;
  warrantyStatus: WarrantyStatus;
  warrantyLabel: string;
  quoteEuros: string;
  refundEuros: string;
  currency: string;
  deliveryMode: string;
  estimatedAt: string;
};

type EditDraft = {
  title: string;
  description: string;
  storeId: string;
  warrantyStatus: WarrantyStatus;
  warrantyLabel: string;
  quoteEuros: string;
  refundEuros: string;
  currency: string;
  deliveryMode: string;
  estimatedAt: string;
};

const roleLabels: Record<Role, string> = {
  super_admin: 'Super-administrateur',
  sav_manager: 'Responsable SAV',
  sc_manager: 'Responsable service client',
  adviser: 'Conseiller',
  analyst: 'Analyste',
};

const warrantyLabels: Record<WarrantyStatus, string> = {
  covered: 'Sous garantie',
  not_covered: 'Hors garantie',
  partial: 'Prise en charge partielle',
  unknown: 'À confirmer',
};

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return productionRequest<T>(path.replace(/^\/api\/production/, ''), init);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
}

function formatMetric(value: number | null, suffix = '') {
  return value === null
    ? '—'
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function formatMoney(value: number | null, currency = 'EUR') {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
    }).format(value / 100);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

function centsToInput(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2);
}

function eurosToCents(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Montant invalide.');
  return Math.round(amount * 100);
}

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Échéance invalide.');
  return date.toISOString();
}

function customerLabel(customer: CustomerSummary | null) {
  if (!customer) return '—';
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  return name || customer.email || customer.external_id || 'Client renseigné';
}

function createDraftForRole(role: Role | undefined): CreateDraft {
  const serviceType: CaseServiceType = role === 'sc_manager' ? 'customer_service' : 'sav';
  return {
    serviceType,
    kind: serviceKinds(serviceType)[0],
    title: '',
    description: '',
    customerExternalId: '',
    customerFirstName: '',
    customerLastName: '',
    customerEmail: '',
    customerPhone: '',
    productExternalId: '',
    productSku: '',
    productName: '',
    productCategory: '',
    productSerialNumber: '',
    storeId: '',
    warrantyStatus: 'unknown',
    warrantyLabel: '',
    quoteEuros: '',
    refundEuros: '',
    currency: 'EUR',
    deliveryMode: '',
    estimatedAt: '',
  };
}

function editDraftFromCase(value: CaseDetail): EditDraft {
  return {
    title: value.title,
    description: value.description,
    storeId: value.store_id ?? '',
    warrantyStatus: value.warranty_status,
    warrantyLabel: value.warranty_label ?? '',
    quoteEuros: centsToInput(value.quote_cents),
    refundEuros: centsToInput(value.refund_cents),
    currency: value.currency,
    deliveryMode: value.delivery_mode ?? '',
    estimatedAt: toLocalDateTime(value.estimated_at),
  };
}

function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="admin-ops-metric">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export default function AdminOperationsPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<Queue>({ priorities: [], handoffs: [] });
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [formOptions, setFormOptions] = useState<CaseFormOptions>({ stores: [] });
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState<'' | CaseServiceType>('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [note, setNote] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => createDraftForRole(undefined));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLookup | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductLookup | null>(null);
  const [customerLookupQuery, setCustomerLookupQuery] = useState('');
  const [productLookupQuery, setProductLookupQuery] = useState('');
  const [customerLookupResults, setCustomerLookupResults] = useState<CustomerLookup[]>([]);
  const [productLookupResults, setProductLookupResults] = useState<ProductLookup[]>([]);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false);
  const [productLookupBusy, setProductLookupBusy] = useState(false);
  const [customerLookupError, setCustomerLookupError] = useState('');
  const [productLookupError, setProductLookupError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [transitionStatus, setTransitionStatus] = useState<CaseStatus | ''>('');
  const [transitionNote, setTransitionNote] = useState('');
  const [transitionVisible, setTransitionVisible] = useState(true);
  const [rotationReady, setRotationReady] = useState(false);
  const [archiveReady, setArchiveReady] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [oneTimeCode, setOneTimeCode] = useState<{ reference: string; code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const membership = useMemo(
    () => admin?.memberships.find((item) => item.organizationId === organizationId) ?? null,
    [admin, organizationId],
  );
  const canAudit = membership?.role === 'super_admin' || membership?.role === 'analyst';
  const canOverrideHandoff =
    membership?.role === 'super_admin' ||
    membership?.role === 'sav_manager' ||
    membership?.role === 'sc_manager';
  const canCreate =
    membership?.role === 'super_admin' ||
    membership?.role === 'sav_manager' ||
    membership?.role === 'sc_manager';
  const canManageSelected = Boolean(
    selectedCase &&
      !selectedCase.archived_at &&
      canManageCase(membership?.role, selectedCase.service_type),
  );
  const nextStatuses = selectedCase
    ? allowedNextStatuses(selectedCase.service_type, selectedCase.status)
    : [];

  const handleAuthError = useCallback(
    (cause: unknown) => {
      if (
        cause instanceof RequestError &&
        (cause.status === 401 || (cause.status === 403 && cause.code === 'mfa_required'))
      ) {
        setAdmin(null);
        setOverview(null);
        setSelectedCase(null);
        setCases([]);
        setAudit(null);
        router.replace('/admin');
        return true;
      }
      return false;
    },
    [router],
  );

  const loadCase = useCallback(async (caseId: string, orgId: string) => {
    if (!caseId || !orgId) return null;
    const params = new URLSearchParams({ organizationId: orgId, caseId });
    const result = await request<{ case: CaseDetail }>(
      `/api/production/admin/operations/case?${params}`,
    );
    setSelectedCase(result.case);
    setEditing(false);
    setEditDraft(null);
    setRotationReady(false);
    setArchiveReady(false);
    setArchiveReason('');
    setArchiveConfirmed(false);
    const allowed = allowedNextStatuses(result.case.service_type, result.case.status);
    setTransitionStatus(allowed[0] ?? '');
    setTransitionNote('');
    setTransitionVisible(true);
    return result.case;
  }, []);

  const loadFormOptions = useCallback(async (orgId: string) => {
    const params = new URLSearchParams({ organizationId: orgId });
    const result = await request<CaseFormOptions>(
      `/api/production/admin/operations/case/options?${params}`,
    );
    setFormOptions(result);
  }, []);

  const lookupEntity = useCallback(
    async <T extends CustomerLookup | ProductLookup>(
      orgId: string,
      type: 'customer' | 'product',
      query: string,
      signal: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        organizationId: orgId,
        type,
        q: query,
      });
      return request<{ entity_type: typeof type; query: string; items: T[] }>(
        `/api/production/admin/operations/case/entities?${params}`,
        { signal },
      );
    },
    [],
  );

  useEffect(() => {
    if (!showCreate || selectedCustomer || customerLookupQuery.trim().length < 3)
      return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCustomerLookupBusy(true);
      setCustomerLookupError('');
      void lookupEntity<CustomerLookup>(
        organizationId,
        'customer',
        customerLookupQuery.trim(),
        controller.signal,
      )
        .then((result) => setCustomerLookupResults(result.items))
        .catch((cause) => {
          if (controller.signal.aborted) return;
          if (!handleAuthError(cause))
            setCustomerLookupError(
              cause instanceof Error ? cause.message : 'Recherche client indisponible.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setCustomerLookupBusy(false);
        });
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    customerLookupQuery,
    handleAuthError,
    lookupEntity,
    organizationId,
    selectedCustomer,
    showCreate,
  ]);

  useEffect(() => {
    if (!showCreate || selectedProduct || productLookupQuery.trim().length < 3)
      return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setProductLookupBusy(true);
      setProductLookupError('');
      void lookupEntity<ProductLookup>(
        organizationId,
        'product',
        productLookupQuery.trim(),
        controller.signal,
      )
        .then((result) => setProductLookupResults(result.items))
        .catch((cause) => {
          if (controller.signal.aborted) return;
          if (!handleAuthError(cause))
            setProductLookupError(
              cause instanceof Error ? cause.message : 'Recherche produit indisponible.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setProductLookupBusy(false);
        });
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    handleAuthError,
    lookupEntity,
    organizationId,
    productLookupQuery,
    selectedProduct,
    showCreate,
  ]);

  const loadCaseList = useCallback(
    async (orgId: string, filters: CaseListFilters) => {
      const params = new URLSearchParams({
        organizationId: orgId,
        search: filters.search,
        limit: '30',
        archive: filters.archive,
      });
      if (filters.service) params.set('serviceType', filters.service);
      const result = await request<{ items: AdminCase[]; total: number }>(
        `/api/production/admin/cases?${params}`,
      );
      setCases(result.items);
      setCaseTotal(result.total);
      return result;
    },
    [],
  );

  const loadAll = useCallback(
    async (orgId: string, role: Role | undefined, filters: CaseListFilters) => {
      if (!orgId) return;
      setBusy(true);
      setError('');
      try {
        const params = new URLSearchParams({ organizationId: orgId });
        const overviewPromise = request<{ overview: Overview }>(
          `/api/production/admin/operations/overview?${params}`,
        );
        const queuePromise = request<{ queue: Queue }>(
          `/api/production/admin/operations/queue?${params}`,
        );
        const listPromise = loadCaseList(orgId, filters);
        const auditPromise =
          role === 'super_admin' || role === 'analyst'
            ? request<{ audit: Audit }>(
                `/api/production/admin/operations/audit?${params}`,
              )
            : Promise.resolve(null);

        const [overviewResult, queueResult, , auditResult] = await Promise.all([
          overviewPromise,
          queuePromise,
          listPromise,
          auditPromise,
        ]);

        setOverview(overviewResult.overview);
        setQueue(queueResult.queue);
        setAudit(auditResult?.audit ?? null);
      } catch (cause) {
        if (!handleAuthError(cause))
          setError(
            cause instanceof Error ? cause.message : 'Chargement opérationnel impossible.',
          );
      } finally {
        setBusy(false);
      }
    },
    [handleAuthError, loadCaseList],
  );

  useEffect(() => {
    let active = true;
    void request<{ admin: Admin }>('/api/production/admin/session')
      .then(async (result) => {
        if (!active) return;
        const first = result.admin.memberships[0];
        if (!first)
          throw new RequestError(
            'Aucune organisation autorisée.',
            403,
            'organization_denied',
          );
        setAdmin(result.admin);
        setOrganizationId(first.organizationId);
        setCreateDraft(createDraftForRole(first.role));
        await loadAll(first.organizationId, first.role, {
          search: '',
          service: '',
          archive: 'active',
        });
      })
      .catch((cause) => {
        if (active && !handleAuthError(cause))
          setError(cause instanceof Error ? cause.message : 'Ouverture impossible.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [handleAuthError, loadAll]);

  async function openCase(caseId: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await loadCase(caseId, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(
          cause instanceof Error ? cause.message : 'Détail du dossier indisponible.',
        );
    } finally {
      setBusy(false);
    }
  }

  async function applySearch(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setBusy(true);
    setError('');
    try {
      await loadCaseList(organizationId, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      setSelectedCase(null);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Recherche impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function changeFilters(
    nextService: '' | CaseServiceType,
    nextArchive: 'active' | 'archived' | 'all',
  ) {
    setServiceFilter(nextService);
    setArchiveFilter(nextArchive);
    setBusy(true);
    setError('');
    try {
      await loadCaseList(organizationId, {
        search,
        service: nextService,
        archive: nextArchive,
      });
      setSelectedCase(null);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Filtrage impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function startCreate() {
    if (!canCreate || !membership) return;
    setError('');
    setSuccess('');
    setOneTimeCode(null);
    setCreateDraft(createDraftForRole(membership.role));
    setSelectedCustomer(null);
    setSelectedProduct(null);
    setCustomerLookupQuery('');
    setProductLookupQuery('');
    setCustomerLookupResults([]);
    setProductLookupResults([]);
    setCustomerLookupBusy(false);
    setProductLookupBusy(false);
    setCustomerLookupError('');
    setProductLookupError('');
    try {
      if (!formOptions.stores.length) await loadFormOptions(organizationId);
      setShowCreate(true);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Préparation du formulaire impossible.');
    }
  }

  function chooseCustomer(customer: CustomerLookup) {
    setSelectedCustomer(customer);
    setCustomerLookupQuery('');
    setCustomerLookupResults([]);
    setCustomerLookupBusy(false);
    setCustomerLookupError('');
    setCreateDraft((draft) => ({
      ...draft,
      customerExternalId: '',
      customerFirstName: '',
      customerLastName: '',
      customerEmail: '',
      customerPhone: '',
    }));
  }

  function clearCustomerSelection() {
    setSelectedCustomer(null);
    setCustomerLookupQuery('');
    setCustomerLookupResults([]);
    setCustomerLookupBusy(false);
    setCustomerLookupError('');
  }

  function chooseProduct(product: ProductLookup) {
    setSelectedProduct(product);
    setProductLookupQuery('');
    setProductLookupResults([]);
    setProductLookupBusy(false);
    setProductLookupError('');
    setCreateDraft((draft) => ({
      ...draft,
      productExternalId: '',
      productSku: '',
      productName: '',
      productCategory: '',
      productSerialNumber: '',
    }));
  }

  function clearProductSelection() {
    setSelectedProduct(null);
    setProductLookupQuery('');
    setProductLookupResults([]);
    setProductLookupBusy(false);
    setProductLookupError('');
  }

  async function createCase(event: FormEvent) {
    event.preventDefault();
    if (!membership || !canManageCase(membership.role, createDraft.serviceType)) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const customer =
        !selectedCustomer && (
        createDraft.customerExternalId ||
        createDraft.customerFirstName ||
        createDraft.customerLastName ||
        createDraft.customerEmail ||
        createDraft.customerPhone
        )
          ? {
              externalId: createDraft.customerExternalId || null,
              firstName: createDraft.customerFirstName || null,
              lastName: createDraft.customerLastName || null,
              email: createDraft.customerEmail || null,
              phone: createDraft.customerPhone || null,
            }
          : null;
      const product = !selectedProduct && createDraft.productName
        ? {
            externalId: createDraft.productExternalId || null,
            sku: createDraft.productSku || null,
            name: createDraft.productName,
            category: createDraft.productCategory || null,
            serialNumber: createDraft.productSerialNumber || null,
          }
        : null;
      const result = await request<AccessCodeResult>(
        '/api/production/admin/operations/case/create',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            serviceType: createDraft.serviceType,
            kind: createDraft.kind,
            title: createDraft.title,
            description: createDraft.description,
            customerId: selectedCustomer?.id ?? null,
            customer,
            productId: selectedProduct?.id ?? null,
            product,
            storeId: createDraft.storeId || null,
            warrantyStatus: createDraft.warrantyStatus,
            warrantyLabel: createDraft.warrantyLabel || null,
            quoteCents: eurosToCents(createDraft.quoteEuros),
            refundCents: eurosToCents(createDraft.refundEuros),
            currency: createDraft.currency.toUpperCase(),
            deliveryMode: createDraft.deliveryMode || null,
            estimatedAt: toIsoDateTime(createDraft.estimatedAt),
            requestId: crypto.randomUUID(),
          }),
        },
      );
      if (result.access_code_available && result.access_code)
        setOneTimeCode({ reference: result.reference, code: result.access_code });
      setShowCreate(false);
      setSuccess(`Dossier ${result.reference} créé, sécurisé et audité.`);
      await loadAll(organizationId, membership.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      await loadCase(result.id, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function startEdit() {
    if (!selectedCase || !canManageSelected) return;
    setError('');
    setSuccess('');
    try {
      if (!formOptions.stores.length) await loadFormOptions(organizationId);
      setEditDraft(editDraftFromCase(selectedCase));
      setEditing(true);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Préparation de la modification impossible.',
        );
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase || !editDraft || !canManageSelected || !membership) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const caseId = selectedCase.id;
      const result = await request<MutationResult>(
        '/api/production/admin/operations/case/update',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            caseId,
            expectedVersion: selectedCase.version,
            title: editDraft.title,
            description: editDraft.description,
            customerId: selectedCase.customer_id,
            productId: selectedCase.product_id,
            storeId: editDraft.storeId || null,
            warrantyStatus: editDraft.warrantyStatus,
            warrantyLabel: editDraft.warrantyLabel || null,
            quoteCents: eurosToCents(editDraft.quoteEuros),
            refundCents: eurosToCents(editDraft.refundEuros),
            currency: editDraft.currency.toUpperCase(),
            deliveryMode: editDraft.deliveryMode || null,
            estimatedAt: toIsoDateTime(editDraft.estimatedAt),
            requestId: crypto.randomUUID(),
          }),
        },
      );
      setSuccess(`Dossier ${result.reference} mis à jour et audité.`);
      setEditing(false);
      await loadAll(organizationId, membership.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      await loadCase(caseId, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Modification impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function transitionCase(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase || !transitionStatus || !canManageSelected || !membership) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const caseId = selectedCase.id;
      const result = await request<MutationResult & { status: CaseStatus }>(
        '/api/production/admin/operations/case/transition',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            caseId,
            expectedVersion: selectedCase.version,
            status: transitionStatus,
            note: transitionNote,
            customerVisible: transitionVisible,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      setSuccess(
        `${result.reference} : statut « ${caseStatusLabels[result.status]} » enregistré.`,
      );
      await loadAll(organizationId, membership.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      await loadCase(caseId, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Transition impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function rotateAccessCode() {
    if (!selectedCase || !canManageSelected || !rotationReady || !membership) return;
    setBusy(true);
    setError('');
    setSuccess('');
    setOneTimeCode(null);
    try {
      const caseId = selectedCase.id;
      const result = await request<AccessCodeResult>(
        '/api/production/admin/operations/case/access-code',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            caseId,
            expectedVersion: selectedCase.version,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      if (result.access_code_available && result.access_code)
        setOneTimeCode({ reference: result.reference, code: result.access_code });
      else
        setSuccess(
          'La rotation avait déjà été enregistrée. Générez un nouveau code si vous devez l’afficher.',
        );
      setRotationReady(false);
      await loadAll(organizationId, membership.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      await loadCase(caseId, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Renouvellement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function archiveCase(event: FormEvent) {
    event.preventDefault();
    if (
      !selectedCase ||
      !canManageSelected ||
      !archiveReady ||
      !archiveConfirmed ||
      archiveReason.trim().length < 3 ||
      !membership
    )
      return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await request<MutationResult & { archived: true }>(
        '/api/production/admin/operations/case/archive',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId,
            caseId: selectedCase.id,
            expectedVersion: selectedCase.version,
            reason: archiveReason.trim(),
            requestId: crypto.randomUUID(),
          }),
        },
      );
      setSelectedCase(null);
      setArchiveReady(false);
      setArchiveReason('');
      setArchiveConfirmed(false);
      setSuccess(
        `Dossier ${result.reference} archivé. Les accès client actifs ont été révoqués.`,
      );
      await loadAll(organizationId, membership.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Archivage impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase || selectedCase.archived_at || note.trim().length < 3) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const caseId = selectedCase.id;
      await request('/api/production/admin/operations/case/note', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          caseId,
          version: selectedCase.version,
          note: note.trim(),
          visible: noteVisible,
          requestId: crypto.randomUUID(),
        }),
      });
      setNote('');
      setSuccess(
        noteVisible
          ? 'Message client enregistré et audité.'
          : 'Note interne enregistrée et auditée.',
      );
      await loadAll(organizationId, membership?.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
      await loadCase(caseId, organizationId);
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function manageHandoff(item: Handoff, status: 'assigned' | 'resolved') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await request('/api/production/admin/operations/handoff', {
        method: 'POST',
        body: JSON.stringify({
          organizationId,
          handoffId: item.id,
          status,
          expectedUpdatedAt: item.updated_at,
        }),
      });
      setSuccess(status === 'assigned' ? 'Relais pris en charge.' : 'Relais clôturé.');
      await loadAll(organizationId, membership?.role, {
        search,
        service: serviceFilter,
        archive: archiveFilter,
      });
    } catch (cause) {
      if (!handleAuthError(cause))
        setError(cause instanceof Error ? cause.message : 'Mise à jour du relais impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function copyOneTimeCode() {
    if (!oneTimeCode) return;
    try {
      await navigator.clipboard.writeText(
        `${oneTimeCode.reference} · ${oneTimeCode.code}`,
      );
      setSuccess('Référence et code copiés.');
    } catch {
      setError('Copie automatique indisponible. Recopiez le code affiché.');
    }
  }

  if (loading)
    return (
      <main className="admin-ops-loading">
        <LoaderCircle className="spin" />
        <span>Ouverture du centre opérationnel…</span>
      </main>
    );

  if (!admin || !overview)
    return (
      <main className="admin-ops-page">
        <header className="admin-ops-topbar">
          <a href="/admin">
            <ArrowLeft size={17} /> Connexion administrateur
          </a>
        </header>
        <div className="admin-ops-content">
          <h1>Centre opérationnel indisponible</h1>
          <div className="admin-ops-alert error" role="alert">
            <AlertTriangle size={18} />
            <span>
              {error || 'Connectez-vous pour accéder à votre organisation.'}
            </span>
          </div>
          <p>
            Aucun indicateur ne peut être affiché tant que la connexion et le chargement
            ne sont pas validés.
          </p>
          {admin && (
            <button
              disabled={busy}
              onClick={() =>
                void loadAll(organizationId, membership?.role, {
                  search,
                  service: serviceFilter,
                  archive: archiveFilter,
                })
              }
            >
              Réessayer
            </button>
          )}
        </div>
      </main>
    );

  return (
    <main className="admin-ops-page">
      <header className="admin-ops-topbar">
        <a href="/admin">
          <ArrowLeft size={17} /> Tableau de bord
        </a>
        <div>
          {admin.memberships.length > 1 && (
            <select
              aria-label="Organisation"
              value={organizationId}
              onChange={(event) => {
                const value = event.target.value;
                const next = admin.memberships.find(
                  (item) => item.organizationId === value,
                );
                setOrganizationId(value);
                setSearch('');
                setServiceFilter('');
                setArchiveFilter('active');
                setSelectedCase(null);
                setShowCreate(false);
                setOneTimeCode(null);
                setSelectedCustomer(null);
                setSelectedProduct(null);
                setCustomerLookupQuery('');
                setProductLookupQuery('');
                setCustomerLookupResults([]);
                setProductLookupResults([]);
                setCustomerLookupBusy(false);
                setProductLookupBusy(false);
                setCustomerLookupError('');
                setProductLookupError('');
                setCreateDraft(createDraftForRole(next?.role));
                void loadAll(value, next?.role, {
                  search: '',
                  service: '',
                  archive: 'active',
                });
              }}
            >
              {admin.memberships.map((item) => (
                <option value={item.organizationId} key={item.organizationId}>
                  {item.organizationName}
                </option>
              ))}
            </select>
          )}
          {canCreate && (
            <button disabled={busy} onClick={() => void startCreate()}>
              <FilePlus2 size={16} /> Nouveau dossier
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void loadAll(organizationId, membership?.role, {
                search,
                service: serviceFilter,
                archive: archiveFilter,
              })
            }
          >
            <RefreshCw className={busy ? 'spin' : ''} size={16} /> Actualiser
          </button>
        </div>
      </header>

      <div className="admin-ops-content">
        <section className="admin-ops-heading">
          <div>
            <span>
              <Activity size={15} /> CENTRE OPÉRATIONNEL
            </span>
            <h1>Agir sur ce qui compte maintenant.</h1>
            <p>
              Création, cycle de vie, accès client, priorités et audit sur des données
              réellement enregistrées.
            </p>
          </div>
          <aside>
            <ShieldCheck size={18} />
            <div>
              <strong>MFA AAL2</strong>
              <small>
                {membership
                  ? `${membership.organizationName} · ${roleLabels[membership.role]}`
                  : 'Accès sécurisé'}
              </small>
            </div>
          </aside>
        </section>

        {error && (
          <div className="admin-ops-alert error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="admin-ops-alert success" role="status">
            <CheckCircle2 size={18} />
            <span>{success}</span>
          </div>
        )}

        {oneTimeCode && (
          <section className="admin-ops-one-time" aria-live="polite">
            <div>
              <KeyRound size={20} />
              <span>
                <strong>Code d’accès à transmettre une seule fois</strong>
                <small>
                  {oneTimeCode.reference} · ce code n’est jamais stocké en clair et ne
                  pourra pas être réaffiché.
                </small>
              </span>
            </div>
            <code>{oneTimeCode.code}</code>
            <div>
              <button onClick={() => void copyOneTimeCode()}>
                <Copy size={15} /> Copier
              </button>
              <button className="ghost" onClick={() => setOneTimeCode(null)}>
                <X size={15} /> Masquer
              </button>
            </div>
          </section>
        )}

        {showCreate && canCreate && (
          <section className="admin-ops-manager">
            <header>
              <div>
                <p>NOUVEAU DOSSIER</p>
                <h2>Créer un dossier SAV ou Service client</h2>
              </div>
              <button
                className="ghost"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                <X size={16} /> Fermer
              </button>
            </header>
            <form className="admin-ops-manager-form" onSubmit={createCase}>
              <div className="admin-ops-form-grid">
                <label>
                  Service
                  <select
                    value={createDraft.serviceType}
                    disabled={membership?.role !== 'super_admin'}
                    onChange={(event) => {
                      const serviceType = event.target.value as CaseServiceType;
                      setCreateDraft((draft) => ({
                        ...draft,
                        serviceType,
                        kind: serviceKinds(serviceType)[0],
                      }));
                    }}
                  >
                    {(membership?.role === 'super_admin'
                      ? (['sav', 'customer_service'] as CaseServiceType[])
                      : membership?.role === 'sc_manager'
                        ? (['customer_service'] as CaseServiceType[])
                        : (['sav'] as CaseServiceType[])
                    ).map((value) => (
                      <option key={value} value={value}>
                        {caseServiceLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type de demande
                  <select
                    value={createDraft.kind}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        kind: event.target.value as CaseKind,
                      }))
                    }
                  >
                    {serviceKinds(createDraft.serviceType).map((value) => (
                      <option key={value} value={value}>
                        {caseKindLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  Objet du dossier
                  <input
                    required
                    minLength={2}
                    maxLength={180}
                    value={createDraft.title}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({ ...draft, title: event.target.value }))
                    }
                    placeholder="Ex. Écran noir intermittent"
                  />
                </label>
                <label className="wide">
                  Description
                  <textarea
                    maxLength={6000}
                    value={createDraft.description}
                    onChange={(event) =>
                      setCreateDraft((draft) => ({
                        ...draft,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Contexte factuel utile au traitement…"
                  />
                </label>
              </div>

              <fieldset>
                <legend>Client</legend>
                <div className="admin-ops-entity-picker">
                  {selectedCustomer ? (
                    <div className="admin-ops-entity-selected">
                      <span>
                        <UserCheck size={18} />
                        <strong>
                          {selectedCustomer.display_name ||
                            selectedCustomer.email ||
                            selectedCustomer.external_id ||
                            'Client existant'}
                        </strong>
                        <small>
                          {[
                            selectedCustomer.external_id,
                            selectedCustomer.email,
                            selectedCustomer.phone,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Fiche client existante'}
                        </small>
                      </span>
                      <button
                        className="ghost"
                        type="button"
                        onClick={clearCustomerSelection}
                      >
                        <X size={15} /> Changer
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="admin-ops-entity-search">
                        Rechercher un client existant
                        <span>
                          <Search size={16} />
                          <input
                            maxLength={80}
                            value={customerLookupQuery}
                            onChange={(event) => {
                              setCustomerLookupQuery(event.target.value);
                              setCustomerLookupResults([]);
                              setCustomerLookupBusy(false);
                              setCustomerLookupError('');
                            }}
                            placeholder="Nom, e-mail, téléphone ou identifiant"
                            autoComplete="off"
                          />
                          {customerLookupBusy && (
                            <LoaderCircle className="spin" size={16} aria-label="Recherche en cours" />
                          )}
                        </span>
                      </label>
                      <div
                        className="admin-ops-entity-status"
                        aria-live="polite"
                      >
                        {customerLookupError && (
                          <span className="error">{customerLookupError}</span>
                        )}
                        {!customerLookupError &&
                          customerLookupQuery.trim().length > 0 &&
                          customerLookupQuery.trim().length < 3 && (
                            <span>Saisissez au moins 3 caractères.</span>
                          )}
                        {!customerLookupBusy &&
                          !customerLookupError &&
                          customerLookupQuery.trim().length >= 3 &&
                          customerLookupResults.length === 0 && (
                            <span>
                              Aucun client existant trouvé. Vous pouvez renseigner une
                              nouvelle fiche ci-dessous.
                            </span>
                          )}
                      </div>
                      {customerLookupResults.length > 0 && (
                        <div
                          className="admin-ops-entity-results"
                          role="listbox"
                          aria-label="Clients existants"
                        >
                          {customerLookupResults.map((customer) => (
                            <button
                              key={customer.id}
                              type="button"
                              role="option"
                              aria-selected="false"
                              onClick={() => chooseCustomer(customer)}
                            >
                              <span>
                                <strong>
                                  {customer.display_name ||
                                    customer.email ||
                                    customer.external_id ||
                                    'Client existant'}
                                </strong>
                                <small>
                                  {[customer.external_id, customer.email, customer.phone]
                                    .filter(Boolean)
                                    .join(' · ') || 'Informations disponibles'}
                                </small>
                              </span>
                              <Check size={16} />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="admin-ops-entity-divider">
                        <span>ou renseigner un nouveau client</span>
                      </div>
                    </>
                  )}
                </div>

                {!selectedCustomer && (
                  <div className="admin-ops-form-grid">
                    <label>
                      Identifiant externe
                      <input
                        maxLength={160}
                        value={createDraft.customerExternalId}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            customerExternalId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Prénom
                      <input
                        maxLength={160}
                        value={createDraft.customerFirstName}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            customerFirstName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Nom
                      <input
                        maxLength={160}
                        value={createDraft.customerLastName}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            customerLastName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        maxLength={320}
                        value={createDraft.customerEmail}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            customerEmail: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Téléphone
                      <input
                        maxLength={80}
                        value={createDraft.customerPhone}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            customerPhone: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </fieldset>

              <fieldset>
                <legend>Produit et magasin</legend>
                <div className="admin-ops-entity-picker">
                  {selectedProduct ? (
                    <div className="admin-ops-entity-selected">
                      <span>
                        <FileSearch size={18} />
                        <strong>{selectedProduct.name}</strong>
                        <small>
                          {[
                            selectedProduct.sku,
                            selectedProduct.serial_number,
                            selectedProduct.external_id,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Produit existant'}
                        </small>
                      </span>
                      <button
                        className="ghost"
                        type="button"
                        onClick={clearProductSelection}
                      >
                        <X size={15} /> Changer
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="admin-ops-entity-search">
                        Rechercher un produit existant
                        <span>
                          <Search size={16} />
                          <input
                            maxLength={80}
                            value={productLookupQuery}
                            onChange={(event) => {
                              setProductLookupQuery(event.target.value);
                              setProductLookupResults([]);
                              setProductLookupBusy(false);
                              setProductLookupError('');
                            }}
                            placeholder="Nom, SKU, n° série ou identifiant"
                            autoComplete="off"
                          />
                          {productLookupBusy && (
                            <LoaderCircle className="spin" size={16} aria-label="Recherche en cours" />
                          )}
                        </span>
                      </label>
                      <div
                        className="admin-ops-entity-status"
                        aria-live="polite"
                      >
                        {productLookupError && (
                          <span className="error">{productLookupError}</span>
                        )}
                        {!productLookupError &&
                          productLookupQuery.trim().length > 0 &&
                          productLookupQuery.trim().length < 3 && (
                            <span>Saisissez au moins 3 caractères.</span>
                          )}
                        {!productLookupBusy &&
                          !productLookupError &&
                          productLookupQuery.trim().length >= 3 &&
                          productLookupResults.length === 0 && (
                            <span>
                              Aucun produit existant trouvé. Vous pouvez renseigner un
                              nouveau produit ci-dessous.
                            </span>
                          )}
                      </div>
                      {productLookupResults.length > 0 && (
                        <div
                          className="admin-ops-entity-results"
                          role="listbox"
                          aria-label="Produits existants"
                        >
                          {productLookupResults.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              role="option"
                              aria-selected="false"
                              onClick={() => chooseProduct(product)}
                            >
                              <span>
                                <strong>{product.name}</strong>
                                <small>
                                  {[product.sku, product.serial_number, product.external_id]
                                    .filter(Boolean)
                                    .join(' · ') ||
                                    product.category ||
                                    'Informations disponibles'}
                                </small>
                              </span>
                              <Check size={16} />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="admin-ops-entity-divider">
                        <span>ou renseigner un nouveau produit</span>
                      </div>
                    </>
                  )}
                </div>

                {!selectedProduct && (
                  <div className="admin-ops-form-grid">
                    <label>
                      Produit
                      <input
                        maxLength={240}
                        value={createDraft.productName}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            productName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      SKU
                      <input
                        maxLength={120}
                        value={createDraft.productSku}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            productSku: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      N° série
                      <input
                        maxLength={160}
                        value={createDraft.productSerialNumber}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            productSerialNumber: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Catégorie
                      <input
                        maxLength={160}
                        value={createDraft.productCategory}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            productCategory: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Identifiant produit externe
                      <input
                        maxLength={160}
                        value={createDraft.productExternalId}
                        onChange={(event) =>
                          setCreateDraft((draft) => ({
                            ...draft,
                            productExternalId: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                )}

                <div className="admin-ops-form-grid admin-ops-store-row">
                  <label>
                    Magasin
                    <select
                      value={createDraft.storeId}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          storeId: event.target.value,
                        }))
                      }
                    >
                      <option value="">Non renseigné</option>
                      {formOptions.stores.map((store) => (
                        <option value={store.id} key={store.id}>
                          {store.name}
                          {store.city ? ` · ${store.city}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>

              <fieldset>
                <legend>Prise en charge</legend>
                <div className="admin-ops-form-grid">
                  <label>
                    Garantie
                    <select
                      value={createDraft.warrantyStatus}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          warrantyStatus: event.target.value as WarrantyStatus,
                        }))
                      }
                    >
                      {Object.entries(warrantyLabels).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Libellé garantie
                    <input
                      maxLength={240}
                      value={createDraft.warrantyLabel}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          warrantyLabel: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Devis (€)
                    <input
                      inputMode="decimal"
                      value={createDraft.quoteEuros}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          quoteEuros: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Remboursement (€)
                    <input
                      inputMode="decimal"
                      value={createDraft.refundEuros}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          refundEuros: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Devise
                    <input
                      maxLength={3}
                      value={createDraft.currency}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          currency: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Mode de remise / réponse
                    <input
                      maxLength={240}
                      value={createDraft.deliveryMode}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          deliveryMode: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Échéance estimée
                    <input
                      type="datetime-local"
                      value={createDraft.estimatedAt}
                      onChange={(event) =>
                        setCreateDraft((draft) => ({
                          ...draft,
                          estimatedAt: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <div className="admin-ops-manager-actions">
                <span>
                  <ShieldCheck size={15} />
                  Référence générée côté serveur · code d’accès haché · action auditée
                </span>
                <button
                  type="submit"
                  disabled={busy || createDraft.title.trim().length < 2}
                >
                  {busy ? <LoaderCircle className="spin" size={16} /> : <FilePlus2 size={16} />}
                  Créer le dossier
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="admin-ops-metrics" aria-label="Indicateurs opérationnels">
          <Metric
            label="Dossiers ouverts"
            value={String(overview.cases.open)}
            detail={`${overview.cases.total} au total`}
            icon={<FileText />}
          />
          <Metric
            label="Échéances dépassées"
            value={String(overview.cases.overdue)}
            detail={`${overview.cases.without_eta} sans échéance`}
            icon={<Clock3 />}
          />
          <Metric
            label="Dossiers stagnants"
            value={String(overview.cases.stale)}
            detail="Sans mise à jour depuis 3 jours"
            icon={<AlertTriangle />}
          />
          <Metric
            label="Relais ouverts"
            value={String(overview.handoffs.open)}
            detail={`${overview.handoffs.unassigned} non assignés`}
            icon={<Users />}
          />
          <Metric
            label="P95 API · 24 h"
            value={formatMetric(overview.performance.p95_latency_ms_24h, ' ms')}
            detail={`${overview.performance.requests_24h} requêtes observées`}
            icon={<BarChart3 />}
          />
          <Metric
            label="Taux d’erreur · 24 h"
            value={formatMetric(overview.performance.error_rate_24h, ' %')}
            detail={`${overview.performance.rate_limited_24h} limitations`}
            icon={<ShieldCheck />}
          />
        </section>

        <section className="admin-ops-grid">
          <article className="admin-ops-panel">
            <header>
              <div>
                <p>PRIORITÉS</p>
                <h2>Dossiers à traiter</h2>
              </div>
              <span>{queue.priorities.length}</span>
            </header>
            <div className="admin-ops-list">
              {queue.priorities.length ? (
                queue.priorities.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => void openCase(item.id)}
                    className="admin-ops-priority"
                  >
                    <span>
                      <strong>{item.reference}</strong>
                      <small>{item.title}</small>
                    </span>
                    <span>
                      <b>{caseStatusLabels[item.status as CaseStatus] ?? item.status}</b>
                      <small>
                        {item.estimated_at
                          ? `Échéance ${formatDate(item.estimated_at)}`
                          : 'Sans échéance'}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="admin-ops-empty">
                  <CheckCircle2 />
                  <strong>Aucune priorité critique</strong>
                  <span>La file ne contient aucun dossier en retard ou bloqué.</span>
                </div>
              )}
            </div>
          </article>

          <article className="admin-ops-panel">
            <header>
              <div>
                <p>RELAIS CONSEILLERS</p>
                <h2>Interventions humaines</h2>
              </div>
              <span>{queue.handoffs.length}</span>
            </header>
            <div className="admin-ops-list">
              {queue.handoffs.length ? (
                queue.handoffs.map((item) => {
                  const mine = item.assigned_to === admin.userId;
                  const canResolve = mine || canOverrideHandoff;
                  return (
                    <div className="admin-ops-handoff" key={item.id}>
                      <div>
                        <strong>{item.reference ?? 'Sans dossier lié'}</strong>
                        <small>{item.summary}</small>
                        <em>
                          {item.assigned_to
                            ? mine
                              ? 'Assigné à vous'
                              : 'Déjà assigné'
                            : 'Non assigné'}{' '}
                          · {formatDate(item.created_at)}
                        </em>
                      </div>
                      <div>
                        {!item.assigned_to && (
                          <button
                            disabled={busy}
                            onClick={() => void manageHandoff(item, 'assigned')}
                          >
                            <UserCheck size={15} /> Prendre
                          </button>
                        )}
                        {item.assigned_to && canResolve && (
                          <button
                            disabled={busy}
                            onClick={() => void manageHandoff(item, 'resolved')}
                          >
                            <CheckCircle2 size={15} /> Résoudre
                          </button>
                        )}
                        {item.case_id && (
                          <button
                            className="ghost"
                            onClick={() => void openCase(item.case_id!)}
                          >
                            <FileSearch size={15} /> Dossier
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="admin-ops-empty">
                  <CheckCircle2 />
                  <strong>Aucun relais en attente</strong>
                  <span>Aucune intervention humaine ouverte ou assignée.</span>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="admin-ops-case-grid">
          <article className="admin-ops-panel">
            <header>
              <div>
                <p>DOSSIERS</p>
                <h2>Recherche opérationnelle</h2>
              </div>
              <span>{caseTotal}</span>
            </header>
            <form onSubmit={applySearch} className="admin-ops-search admin-ops-search-advanced">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Référence, client, produit…"
                maxLength={120}
                aria-label="Rechercher un dossier"
              />
              <select
                aria-label="Filtrer par service"
                value={serviceFilter}
                onChange={(event) =>
                  void changeFilters(
                    event.target.value as '' | CaseServiceType,
                    archiveFilter,
                  )
                }
              >
                <option value="">Tous les services</option>
                <option value="sav">SAV</option>
                <option value="customer_service">Service client</option>
              </select>
              <select
                aria-label="Filtrer les archives"
                value={archiveFilter}
                onChange={(event) =>
                  void changeFilters(
                    serviceFilter,
                    event.target.value as 'active' | 'archived' | 'all',
                  )
                }
              >
                <option value="active">Actifs</option>
                <option value="archived">Archivés</option>
                <option value="all">Tous</option>
              </select>
              <button disabled={busy}>Rechercher</button>
            </form>
            <div className="admin-ops-case-results">
              {cases.map((item) => (
                <button
                  className={selectedCase?.id === item.id ? 'active' : ''}
                  key={item.id}
                  onClick={() => void openCase(item.id)}
                >
                  <span>
                    <strong>{item.reference}</strong>
                    <small>
                      {caseServiceLabels[item.service_type]} · {item.product ?? item.title}
                    </small>
                  </span>
                  <span>
                    <b>
                      {item.archived_at
                        ? 'Archivé'
                        : caseStatusLabels[item.status] ?? item.status}
                    </b>
                    <small>{formatDate(item.updated_at)}</small>
                  </span>
                </button>
              ))}
              {!cases.length && (
                <div className="admin-ops-empty">
                  <FileSearch />
                  <strong>Aucun dossier trouvé</strong>
                  <span>Modifiez votre recherche ou vos filtres puis réessayez.</span>
                </div>
              )}
            </div>
          </article>

          <article className="admin-ops-panel">
            <header>
              <div>
                <p>DÉTAIL DOSSIER</p>
                <h2>{selectedCase ? selectedCase.reference : 'Sélectionnez un dossier'}</h2>
              </div>
              {selectedCase && (
                <span>
                  {selectedCase.archived_at
                    ? 'Archivé'
                    : caseStatusLabels[selectedCase.status]}
                </span>
              )}
            </header>

            {selectedCase ? (
              <div className="admin-ops-detail">
                <div className="admin-ops-detail-facts">
                  <div>
                    <small>Demande</small>
                    <strong>{selectedCase.product?.name ?? selectedCase.title}</strong>
                    <span>
                      {caseServiceLabels[selectedCase.service_type]} ·{' '}
                      {caseKindLabels[selectedCase.kind]}
                    </span>
                  </div>
                  <div>
                    <small>Client</small>
                    <strong>{customerLabel(selectedCase.customer)}</strong>
                    <span>
                      {selectedCase.store?.name ?? 'Magasin non renseigné'}
                    </span>
                  </div>
                  <div>
                    <small>Échéance</small>
                    <strong>{formatDate(selectedCase.estimated_at)}</strong>
                    <span>
                      Version {selectedCase.version} · mise à jour{' '}
                      {formatDate(selectedCase.updated_at)}
                    </span>
                  </div>
                </div>

                {selectedCase.archived_at && (
                  <div className="admin-ops-archive-banner">
                    <Archive size={17} />
                    <span>
                      <strong>Dossier archivé le {formatDate(selectedCase.archived_at)}</strong>
                      <small>
                        {selectedCase.archive_reason ??
                          'Aucune raison d’archivage renseignée.'}
                      </small>
                    </span>
                  </div>
                )}

                <div className="admin-ops-case-toolbar">
                  <span>
                    <strong>{selectedCase.title}</strong>
                    <small>{selectedCase.description || 'Aucune description.'}</small>
                  </span>
                  {canManageSelected && !editing && (
                    <button onClick={() => void startEdit()}>
                      <Pencil size={15} /> Modifier
                    </button>
                  )}
                </div>

                {editing && editDraft && (
                  <form className="admin-ops-edit-form" onSubmit={saveEdit}>
                    <div className="admin-ops-form-grid">
                      <label className="wide">
                        Objet
                        <input
                          required
                          minLength={2}
                          maxLength={180}
                          value={editDraft.title}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft ? { ...draft, title: event.target.value } : draft,
                            )
                          }
                        />
                      </label>
                      <label className="wide">
                        Description
                        <textarea
                          maxLength={6000}
                          value={editDraft.description}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? { ...draft, description: event.target.value }
                                : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Magasin
                        <select
                          value={editDraft.storeId}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? { ...draft, storeId: event.target.value }
                                : draft,
                            )
                          }
                        >
                          <option value="">Non renseigné</option>
                          {formOptions.stores.map((store) => (
                            <option value={store.id} key={store.id}>
                              {store.name}
                              {store.city ? ` · ${store.city}` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Garantie
                        <select
                          value={editDraft.warrantyStatus}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? {
                                    ...draft,
                                    warrantyStatus: event.target.value as WarrantyStatus,
                                  }
                                : draft,
                            )
                          }
                        >
                          {Object.entries(warrantyLabels).map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Libellé garantie
                        <input
                          maxLength={240}
                          value={editDraft.warrantyLabel}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? { ...draft, warrantyLabel: event.target.value }
                                : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Devis (€)
                        <input
                          inputMode="decimal"
                          value={editDraft.quoteEuros}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft ? { ...draft, quoteEuros: event.target.value } : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Remboursement (€)
                        <input
                          inputMode="decimal"
                          value={editDraft.refundEuros}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft ? { ...draft, refundEuros: event.target.value } : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Devise
                        <input
                          maxLength={3}
                          value={editDraft.currency}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? {
                                    ...draft,
                                    currency: event.target.value.toUpperCase(),
                                  }
                                : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Mode de remise / réponse
                        <input
                          maxLength={240}
                          value={editDraft.deliveryMode}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? { ...draft, deliveryMode: event.target.value }
                                : draft,
                            )
                          }
                        />
                      </label>
                      <label>
                        Échéance
                        <input
                          type="datetime-local"
                          value={editDraft.estimatedAt}
                          onChange={(event) =>
                            setEditDraft((draft) =>
                              draft
                                ? { ...draft, estimatedAt: event.target.value }
                                : draft,
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="admin-ops-inline-actions">
                      <button type="submit" disabled={busy}>
                        <Check size={15} /> Enregistrer
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setEditing(false);
                          setEditDraft(null);
                        }}
                      >
                        <X size={15} /> Annuler
                      </button>
                    </div>
                  </form>
                )}

                <div className="admin-ops-detail-facts admin-ops-financial-facts">
                  <div>
                    <small>Garantie</small>
                    <strong>{warrantyLabels[selectedCase.warranty_status]}</strong>
                    <span>{selectedCase.warranty_label ?? 'Sans précision'}</span>
                  </div>
                  <div>
                    <small>Devis</small>
                    <strong>
                      {formatMoney(selectedCase.quote_cents, selectedCase.currency)}
                    </strong>
                    <span>Montant enregistré</span>
                  </div>
                  <div>
                    <small>Remboursement</small>
                    <strong>
                      {formatMoney(selectedCase.refund_cents, selectedCase.currency)}
                    </strong>
                    <span>{selectedCase.delivery_mode ?? 'Mode non renseigné'}</span>
                  </div>
                </div>

                {canManageSelected && nextStatuses.length > 0 && (
                  <form className="admin-ops-workflow" onSubmit={transitionCase}>
                    <header>
                      <Workflow size={16} />
                      <div>
                        <strong>Faire évoluer le dossier</strong>
                        <small>
                          Seules les transitions autorisées par le cycle métier sont
                          proposées.
                        </small>
                      </div>
                    </header>
                    <div className="admin-ops-form-grid">
                      <label>
                        Nouveau statut
                        <select
                          value={transitionStatus}
                          onChange={(event) =>
                            setTransitionStatus(event.target.value as CaseStatus)
                          }
                        >
                          {nextStatuses.map((value) => (
                            <option value={value} key={value}>
                              {caseStatusLabels[value]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide">
                        Précision facultative
                        <input
                          maxLength={2000}
                          value={transitionNote}
                          onChange={(event) => setTransitionNote(event.target.value)}
                          placeholder="Information factuelle associée au changement…"
                        />
                      </label>
                    </div>
                    <div className="admin-ops-inline-actions">
                      <label className="admin-ops-check">
                        <input
                          type="checkbox"
                          checked={transitionVisible}
                          onChange={(event) =>
                            setTransitionVisible(event.target.checked)
                          }
                        />
                        <span>
                          {transitionVisible
                            ? 'Événement visible par le client'
                            : 'Événement interne uniquement'}
                        </span>
                      </label>
                      <button disabled={busy || !transitionStatus}>
                        <Workflow size={15} /> Appliquer la transition
                      </button>
                    </div>
                  </form>
                )}

                {!selectedCase.archived_at && (
                  <form className="admin-ops-note" onSubmit={submitNote}>
                    <label>
                      Ajouter une note
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        minLength={3}
                        maxLength={4000}
                        placeholder="Écrivez une information utile et factuelle…"
                      />
                    </label>
                    <div>
                      <label className="admin-ops-check">
                        <input
                          type="checkbox"
                          checked={noteVisible}
                          onChange={(event) => setNoteVisible(event.target.checked)}
                        />
                        <span>
                          {noteVisible
                            ? 'Visible par le client'
                            : 'Note interne uniquement'}
                        </span>
                      </label>
                      <button disabled={busy || note.trim().length < 3}>
                        <Send size={15} /> Enregistrer
                      </button>
                    </div>
                  </form>
                )}

                {canManageSelected && (
                  <section className="admin-ops-sensitive">
                    <header>
                      <ShieldCheck size={16} />
                      <div>
                        <strong>Actions sensibles</strong>
                        <small>
                          Confirmation explicite, MFA actif et journal d’audit.
                        </small>
                      </div>
                    </header>

                    <div className="admin-ops-sensitive-action">
                      <div>
                        <RotateCcwKey size={17} />
                        <span>
                          <strong>Renouveler le code d’accès client</strong>
                          <small>
                            Le code actuel et les sessions client ouvertes seront
                            révoqués.
                          </small>
                        </span>
                      </div>
                      {!rotationReady ? (
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => setRotationReady(true)}
                        >
                          Préparer
                        </button>
                      ) : (
                        <div className="admin-ops-confirm-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void rotateAccessCode()}
                          >
                            <KeyRound size={15} /> Confirmer
                          </button>
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => setRotationReady(false)}
                          >
                            Annuler
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="admin-ops-sensitive-action danger">
                      <div>
                        <Archive size={17} />
                        <span>
                          <strong>Archiver le dossier</strong>
                          <small>
                            Aucun effacement physique : historique conservé, accès
                            client révoqué.
                          </small>
                        </span>
                      </div>
                      {!archiveReady ? (
                        <button
                          className="danger"
                          type="button"
                          onClick={() => setArchiveReady(true)}
                        >
                          Préparer
                        </button>
                      ) : (
                        <form className="admin-ops-archive-form" onSubmit={archiveCase}>
                          <label>
                            Motif d’archivage
                            <textarea
                              minLength={3}
                              maxLength={1000}
                              value={archiveReason}
                              onChange={(event) => setArchiveReason(event.target.value)}
                              placeholder="Expliquez pourquoi ce dossier doit être archivé…"
                              required
                            />
                          </label>
                          <label className="admin-ops-check">
                            <input
                              type="checkbox"
                              checked={archiveConfirmed}
                              onChange={(event) =>
                                setArchiveConfirmed(event.target.checked)
                              }
                            />
                            <span>
                              Je confirme la révocation immédiate des accès client.
                            </span>
                          </label>
                          <div className="admin-ops-confirm-actions">
                            <button
                              className="danger"
                              disabled={
                                busy ||
                                !archiveConfirmed ||
                                archiveReason.trim().length < 3
                              }
                            >
                              <Archive size={15} /> Confirmer l’archivage
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                setArchiveReady(false);
                                setArchiveReason('');
                                setArchiveConfirmed(false);
                              }}
                            >
                              Annuler
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </section>
                )}

                <div className="admin-ops-timeline">
                  <h3>
                    <History size={16} /> Historique récent
                  </h3>
                  {selectedCase.events.map((event) => (
                    <div key={event.id}>
                      <i className={event.customer_visible ? 'visible' : ''} />
                      <span>
                        <strong>{event.label}</strong>
                        {event.detail && <small>{event.detail}</small>}
                        <em>
                          {formatDate(event.occurred_at)} ·{' '}
                          {event.customer_visible ? 'client' : 'interne'}
                        </em>
                      </span>
                    </div>
                  ))}
                  {!selectedCase.events.length && <p>Aucun événement enregistré.</p>}
                </div>
              </div>
            ) : (
              <div className="admin-ops-empty detail">
                <FileText />
                <strong>Aucun dossier sélectionné</strong>
                <span>
                  Choisissez une priorité ou un résultat de recherche pour consulter son
                  historique et agir.
                </span>
              </div>
            )}
          </article>
        </section>

        <section className="admin-ops-grid admin-ops-bottom-grid">
          <article className="admin-ops-panel">
            <header>
              <div>
                <p>PERFORMANCE</p>
                <h2>Routes les plus sollicitées</h2>
              </div>
              <Activity size={18} />
            </header>
            <div className="admin-ops-routes">
              {overview.routes.map((route) => (
                <div key={route.route}>
                  <code>{route.route}</code>
                  <span>
                    <strong>{route.requests}</strong> req · {route.errors} err ·{' '}
                    {formatMetric(route.avg_ms, ' ms')}
                  </span>
                </div>
              ))}
              {!overview.routes.length && (
                <div className="admin-ops-empty compact">
                  <Activity />
                  <strong>Pas encore de trafic</strong>
                  <span>Les mesures apparaîtront après les premières requêtes.</span>
                </div>
              )}
            </div>
          </article>
          <article className="admin-ops-panel">
            <header>
              <div>
                <p>AUDIT</p>
                <h2>Actions sensibles récentes</h2>
              </div>
              <History size={18} />
            </header>
            {canAudit ? (
              <div className="admin-ops-audit">
                {(audit?.items ?? []).map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.action}</strong>
                      <small>
                        {item.entity_type ?? 'événement'}
                        {item.entity_id ? ` · ${item.entity_id.slice(0, 8)}…` : ''}
                      </small>
                    </span>
                    <span>
                      <b>{item.outcome}</b>
                      <small>{formatDate(item.created_at)}</small>
                    </span>
                  </div>
                ))}
                {!audit?.items.length && (
                  <div className="admin-ops-empty compact">
                    <History />
                    <strong>Aucun événement d’audit</strong>
                    <span>Les actions sensibles apparaîtront ici.</span>
                  </div>
                )}
                {audit && (
                  <p>
                    {audit.total} événement{audit.total > 1 ? 's' : ''} au total
                  </p>
                )}
              </div>
            ) : (
              <div className="admin-ops-empty">
                <ShieldCheck />
                <strong>Accès restreint</strong>
                <span>
                  Le journal détaillé est réservé aux super-administrateurs et analystes.
                </span>
              </div>
            )}
          </article>
        </section>

        <footer className="admin-ops-footer">
          <span>SAV SC Assistant AI · Centre opérationnel</span>
          <span>
            <MessageSquareText size={14} /> Actions métier contrôlées et auditées
          </span>
        </footer>
      </div>
    </main>
  );
}
