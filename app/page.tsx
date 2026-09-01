'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  FileText,
  FlaskConical,
  Headphones,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Moon,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Truck,
  Wrench,
  X,
  Zap,
  CircleDot,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toaster, toast } from 'sonner';
import { Discovery } from '@/components/atlas/discovery';
import { CaseReceipt } from '@/components/atlas/case-receipt';
import { ContactPage } from '@/components/atlas/contact-page';
import { type CaseBrief } from '@/lib/atlas/case-brief';
import { ApiRequestError, mergeMessages, newRequestId, requestJson } from '@/lib/atlas/client';
import { guideStage, suggestedQuestions } from '@/lib/atlas/experience';
import {
  articles as initialArticles,
  labels,
  nextStep,
  kindLabels,
  finished,
  money,
  validAmount,
  dateTime,
  normalized,
  type Article,
  type CaseKind,
} from '@/lib/atlas/domain';

type Case = {
  id: string;
  reference: string;
  kind: CaseKind;
  title: string;
  description: string;
  status: string;
  status_label: string;
  product: string;
  category: string;
  customer: string;
  city: string;
  store: string;
  warranty: string;
  quote_cents: number | null;
  refund_cents: number | null;
  delivery_mode: string;
  estimate: string | null;
  version: number;
  updated_at: number;
  created_at: number;
  demoCode: string;
  verified: boolean;
};
type Meta = {
  sources?: { id: string; title: string; version: string }[];
  tools?: string[];
  mode?: string;
  fallback?: 'daily_limit' | 'provider_unavailable' | null;
  latencyMs?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  action?: string | null;
  caseVersion?: number | null;
  caseBrief?: CaseBrief | null;
  presentation?: 'case_brief' | 'text';
};
type Message = {
  id: string;
  case_id: string | null;
  role: string;
  content: string;
  metadata: Meta;
  created_at: number;
};
type Snapshot = {
  space: { id: string; csrf: string; expiresAt: number; running: boolean; tick: number };
  cases: Case[];
  events: {
    id: string;
    case_id: string;
    status: string;
    label: string;
    actor: string;
    created_at: number;
  }[];
  messages: Message[];
  handoffs: { id: string; case_id: string; summary: string; status: string; created_at: number }[];
  logs: { action: string; detail: string; created_at: number }[];
  config: {
    provider: string;
    model: string | null;
    ready: boolean;
    retrieval: string;
    budgetMode: string;
    externalCallsAllowed: boolean;
    blockedReason: string | null;
  };
  articles: Article[];
  serverTime: number;
};
type View =
  'assistant' | 'dossiers' | 'contact' | 'operations' | 'simulation' | 'knowledge' | 'project';
const nav = [
  { id: 'assistant', label: 'Assistant', icon: MessageSquareText },
  { id: 'dossiers', label: 'Mes dossiers', icon: FileText },
  { id: 'contact', label: 'Nous contacter', icon: Mail },
  { id: 'operations', label: 'Espace conseiller', icon: Headphones },
  { id: 'simulation', label: 'Laboratoire', icon: FlaskConical },
  { id: 'knowledge', label: 'Connaissances', icon: BookOpen },
  { id: 'project', label: 'Le projet', icon: Code2 },
] as const;
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={'brand ' + (small ? 'small' : '')}>
      <span className="brand-symbol">
        <Sparkles size={small ? 16 : 21} />
      </span>
      {!small && (
        <span>
          SAV SC <span className="brand-light">Assistant</span>
          <sup>AI</sup>
        </span>
      )}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span
      className={
        'status ' +
        (finished(status)
          ? 'success'
          : ['waiting_part', 'quote_pending', 'delayed'].includes(status)
            ? 'warning'
            : 'info')
      }
    >
      <i />
      {labels[status] ?? status}
    </span>
  );
}
function KindIcon({ kind, size = 20 }: { kind: CaseKind; size?: number }) {
  const Icon =
    kind === 'repair'
      ? Wrench
      : kind === 'delivery'
        ? Truck
        : kind === 'complaint'
          ? Headphones
          : kind === 'refund'
            ? FileCheck2
            : Package;
  return <Icon size={size} />;
}
function MiniLabel({ children }: { children: React.ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

function NavigationButton({ onClick, ...props }: React.ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (isMobile) setOpenMobile(false);
      }}
    />
  );
}

function subscribeConnection(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}
const connectionOffline = () => !navigator.onLine;
const serverOffline = () => false;

export default function Home() {
  const [view, setView] = useState<View>('assistant');
  const [showDiscovery, setShowDiscovery] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [consultAfterVerify, setConsultAfterVerify] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState('system');
  const [verify, setVerify] = useState<Case | null>(null);
  const [refValue, setRefValue] = useState('');
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [article, setArticle] = useState<Article | null>(null);
  const [confirm, setConfirm] = useState<{ action: string; case: Case } | null>(null);
  const [reset, setReset] = useState(false);
  const [trace, setTrace] = useState<Message | null>(null);
  const [lastError, setLastError] = useState('');
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const offline = useSyncExternalStore(subscribeConnection, connectionOffline, serverOffline);
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [slowReply, setSlowReply] = useState(false);
  const refreshSequence = useRef(0);
  const operationInFlight = useRef(false);
  const chatInFlight = useRef(false);
  const retryChat = useRef<{
    message: string;
    caseId: string | null;
    requestId: string;
    spaceId: string;
  } | null>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const latestMessage = useRef<HTMLDivElement>(null);
  const conversationError = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const api = useCallback(
    async <T,>(path: string, payload?: unknown, method?: string): Promise<T> => {
      const snapshot = dataRef.current;
      try {
        return await requestJson<T>(
          '/api/' + path,
          {
            method: method ?? (payload === undefined ? 'GET' : 'POST'),
            headers: {
              'Content-Type': 'application/json',
              ...(snapshot ? { 'x-atlas-csrf': snapshot.space.csrf } : {}),
            },
            ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
          },
          path === 'chat' ? 45000 : 20000,
        );
      } catch (e) {
        if (
          e instanceof ApiRequestError &&
          e.status === 401 &&
          snapshot &&
          dataRef.current?.space.id === snapshot.space.id
        ) {
          refreshSequence.current++;
          retryChat.current = null;
          dataRef.current = null;
          setData(null);
          setVerify(null);
          setShowDiscovery(true);
          setView('assistant');
          setLastError(
            'Votre session a expiré. Vous pouvez démarrer un nouvel espace de démonstration.',
          );
        }
        throw e;
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setSyncing(true);
    try {
      const d = await api<Snapshot>('snapshot');
      if (sequence !== refreshSequence.current) return;
      dataRef.current = d;
      setData(d);
      setSyncError('');
      setSelectedId((current) =>
        current && d.cases.some((c: Case) => c.id === current)
          ? current
          : (d.messages.findLast(
              (message) =>
                message.case_id && d.cases.some((c) => c.id === message.case_id && c.verified),
            )?.case_id ??
            d.cases.find((c) => c.verified)?.id ??
            d.cases[0]?.id ??
            null),
      );
    } catch (e) {
      if (sequence === refreshSequence.current && dataRef.current)
        setSyncError('Actualisation interrompue. Le suivi affiché peut avoir changé.');
      throw e;
    } finally {
      if (sequence === refreshSequence.current) setSyncing(false);
    }
  }, [api]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      let stored = 'system';
      try {
        const preference = localStorage.getItem('atlas-theme');
        if (preference && ['system', 'light', 'dark'].includes(preference)) stored = preference;
      } catch {
        // Storage can be disabled; the application still works without a saved theme.
      }
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
      try {
        await refresh();
      } catch (e) {
        if ((e as Error & { status?: number }).status !== 401) setLastError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  const hasData = Boolean(data),
    simulationRunning = Boolean(data?.space.running);
  useEffect(() => {
    const updateConnection = () => {
      if (
        navigator.onLine &&
        dataRef.current &&
        !operationInFlight.current &&
        !chatInFlight.current
      )
        void refresh().catch(() => {});
    };
    window.addEventListener('online', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
    };
  }, [refresh]);
  useEffect(() => {
    if (!sending) return;
    const timer = setTimeout(() => setSlowReply(true), 8000);
    return () => clearTimeout(timer);
  }, [sending]);
  useEffect(() => {
    if (!hasData) return;
    const update = () => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        !operationInFlight.current &&
        !chatInFlight.current
      )
        void refresh().catch(() => {});
    };
    const timer = setInterval(update, simulationRunning ? 6000 : 30000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [hasData, simulationRunning, refresh]);
  const current = data?.cases.find((c) => c.id === selectedId) ?? null;
  const currentVerified = Boolean(current?.verified);
  const messages =
    data?.messages.filter((m) => m.case_id === (currentVerified ? current?.id : null)) ?? [];
  useEffect(() => {
    const container = conversation.current;
    if (!container) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const last = lastError ? conversationError.current : latestMessage.current;
    const top = sending
      ? container.scrollHeight
      : last
        ? container.scrollTop +
          last.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          16
        : 0;
    container.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
  }, [messages.length, sending, selectedId, showDiscovery, view, lastError]);
  function changeTheme() {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('atlas-theme', next);
    } catch {
      // Keep the selected theme for this page even when browser storage is unavailable.
    }
  }
  async function start(reference = 'SAV-2026-1042', guided = false) {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    refreshSequence.current++;
    setBusy(true);
    setLastError('');
    try {
      const d = await api<Snapshot>('session', {});
      dataRef.current = d;
      setData(d);
      setSyncError('');
      const selected = d.cases.find((c: Case) => c.reference === reference) ?? d.cases[0];
      setSelectedId(selected?.id ?? null);
      setShowDiscovery(false);
      setView('assistant');
      setGuideOpen(true);
      setContextOpen(false);
      if (guided && selected && !selected.verified) openVerify(selected, true);
      else toast.success('Votre espace personnel de démonstration est prêt.');
    } catch (e) {
      setLastError((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setSyncing(false);
      setBusy(false);
    }
  }
  function openVerify(c: Case, consult = false) {
    setVerify(c);
    setRefValue(c.reference);
    setCode('');
    setVerifyError('');
    setConsultAfterVerify(consult);
  }
  function selectCase(c: Case) {
    if (busy || sending) return;
    setSelectedId(c.id);
    setView('assistant');
    setGuideOpen(true);
    setContextOpen(false);
    setInput('');
    setLastError('');
    if (!c.verified) openVerify(c, true);
  }
  async function doVerify(e: FormEvent) {
    e.preventDefault();
    if (operationInFlight.current || chatInFlight.current) return;
    operationInFlight.current = true;
    refreshSequence.current++;
    setBusy(true);
    setVerifyError('');
    try {
      const result = await api<{ case: Case }>('verify', { reference: refValue, code });
      await refresh();
      setSelectedId(result.case.id);
      setVerify(null);
      setCode('');
      toast.success('Accès au dossier vérifié.');
      if (consultAfterVerify) await send('Où en est mon dossier ?', result.case.id);
    } catch (e) {
      setVerifyError((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setSyncing(false);
      setBusy(false);
    }
  }
  async function send(value?: string, scopedCaseId?: string) {
    const msg = (value ?? input).trim();
    if (!msg || chatInFlight.current || offline || (operationInFlight.current && !scopedCaseId))
      return;
    const snapshot = dataRef.current;
    if (!snapshot) {
      toast.info('Démarrez votre espace pour discuter.');
      return;
    }
    chatInFlight.current = true;
    refreshSequence.current++;
    setSlowReply(false);
    setInput('');
    setSending(true);
    setPendingMessage(msg);
    setLastError('');
    try {
      const caseId = scopedCaseId ?? (currentVerified ? (current?.id ?? null) : null);
      const prior = retryChat.current;
      const request =
        prior &&
        prior.message === msg &&
        prior.caseId === caseId &&
        prior.spaceId === snapshot.space.id
          ? prior
          : { message: msg, caseId, requestId: newRequestId(), spaceId: snapshot.space.id };
      retryChat.current = request;
      setPendingCaseId(caseId);
      const reply = await api<{ messages: Message[] }>('chat', {
        message: msg,
        caseId,
        requestId: request.requestId,
      });
      if (dataRef.current?.space.id === snapshot.space.id) {
        const updated = {
          ...dataRef.current,
          messages: mergeMessages(dataRef.current.messages, reply.messages),
        };
        dataRef.current = updated;
        setData(updated);
        retryChat.current = null;
        void refresh().catch(() => {});
      }
    } catch (e) {
      setSyncing(false);
      setLastError((e as Error).message);
      setInput(msg);
    } finally {
      chatInFlight.current = false;
      setSending(false);
      setPendingMessage(null);
      setPendingCaseId(null);
    }
  }
  async function simulate(action: string, extra: Record<string, unknown> = {}) {
    if (operationInFlight.current || chatInFlight.current) return;
    operationInFlight.current = true;
    refreshSequence.current++;
    setBusy(true);
    try {
      await api('simulation', { action, ...extra });
      await refresh();
      if (action !== 'toggle')
        toast.success(
          action === 'generate' ? 'Nouveau dossier créé.' : 'Événement simulé enregistré.',
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setSyncing(false);
      setBusy(false);
    }
  }
  async function action(c: Case, type: string, confirmed = false) {
    if (operationInFlight.current || chatInFlight.current) return;
    operationInFlight.current = true;
    refreshSequence.current++;
    setBusy(true);
    try {
      const r = await api<{ message?: string }>('case-action', {
        caseId: c.id,
        action: type,
        version: c.version,
        confirm: confirmed,
        requestId: newRequestId(),
      });
      await refresh();
      toast.success(r.message ?? 'Dossier mis à jour.');
    } catch (e) {
      toast.error((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      operationInFlight.current = false;
      setBusy(false);
      setConfirm(null);
    }
  }
  async function clear() {
    if (operationInFlight.current || chatInFlight.current) return;
    operationInFlight.current = true;
    refreshSequence.current++;
    setBusy(true);
    try {
      await api('session', undefined, 'DELETE');
      dataRef.current = null;
      refreshSequence.current++;
      retryChat.current = null;
      setData(null);
      setSelectedId(null);
      setReset(false);
      setView('assistant');
      setShowDiscovery(true);
      setInput('');
      setLastError('');
      setSyncError('');
      toast.success('Votre espace et son historique ont été supprimés.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setSyncing(false);
      setBusy(false);
    }
  }
  const mode = data?.config.provider ?? 'demo';
  const modeLabel =
    data && !data.config.ready
      ? 'IA non configurée'
      : mode === 'demo'
        ? 'Démo sans LLM'
        : mode === 'ollama'
          ? 'Ollama local · sans API payante'
          : mode === 'gemini'
            ? 'Gemini · offre gratuite limitée'
            : (data?.config.model ?? 'Modèle à configurer');
  const knowledge = data?.articles ?? initialArticles;
  const filtered =
    data?.cases.filter((c) =>
      normalized(c.reference + ' ' + c.product + ' ' + c.customer + ' ' + c.status_label).includes(
        normalized(search),
      ),
    ) ?? [];
  const answered = data?.messages.filter((m) => m.role === 'assistant') ?? [];
  const latency = answered.length
    ? Math.round(answered.reduce((s, m) => s + (m.metadata.latencyMs ?? 0), 0) / answered.length)
    : null;
  const lastAnswer = messages.findLast(
    (m) => m.role === 'assistant' && m.metadata.tools?.includes('get_case'),
  );
  const stage = guideStage(
    currentVerified,
    current?.version ?? 0,
    lastAnswer?.metadata.caseVersion,
    Boolean(lastAnswer),
  );
  const questions = suggestedQuestions(currentVerified ? current : null);
  const unavailable = busy || sending || offline;
  const pendingHere = sending && pendingCaseId === (currentVerified ? current?.id : null);
  const canAdvance = current ? Boolean(nextStep(current.kind, current.status)) : false;
  const guide =
    stage === 'verify'
      ? {
          step: '01',
          title: 'Commençons par votre dossier.',
          body: 'Le code fictif est fourni. Ouvrez votre suivi personnel en toute simplicité.',
          cta: 'Ouvrir mon dossier',
        }
      : stage === 'ask'
        ? {
            step: '02',
            title: 'Posez votre première question.',
            body: 'L’assistant consulte les informations du dossier que vous venez de vérifier.',
            cta: 'Où en est mon dossier ?',
          }
        : stage === 'refresh'
          ? {
              step: '03',
              title: 'Votre dossier a évolué. Et la réponse ?',
              body: 'Interrogez à nouveau l’assistant pour comparer avec son premier état.',
              cta: 'Consulter le nouvel état',
            }
          : stage === 'done'
            ? {
                step: '✓',
                title: 'Votre suivi reflète le dossier actuel.',
                body: 'Continuez la conversation ou explorez une autre situation client.',
                cta: 'Explorer les autres dossiers',
              }
            : current?.status === 'quote_pending'
              ? {
                  step: '03',
                  title: 'Ici, c’est vous qui décidez.',
                  body: 'La simulation attend votre accord explicite. Aucun paiement réel.',
                  cta: 'Examiner le devis',
                }
              : canAdvance
                ? {
                    step: '03',
                    title: 'Faites avancer votre dossier fictif.',
                    body: 'Simulez l’étape suivante, puis voyez comment la réponse change.',
                    cta: 'Simuler l’étape suivante',
                  }
                : {
                    step: '✓',
                    title: 'Ce parcours est arrivé à son terme.',
                    body: 'Une autre situation vous attend : livraison, devis, retour ou remboursement.',
                    cta: 'Explorer les autres dossiers',
                  };
  function followGuide() {
    if (!current) return;
    if (stage === 'verify') openVerify(current, true);
    else if (stage === 'ask' || stage === 'refresh') void send('Où en est mon dossier ?');
    else if (stage === 'done') setView('dossiers');
    else if (current.status === 'quote_pending')
      setConfirm({ action: 'accept_quote', case: current });
    else if (canAdvance) void action(current, 'advance');
    else setView('dossiers');
  }
  const beginButton = (
    <button
      className="button primary"
      disabled={busy || loading || offline}
      onClick={() => start()}
    >
      {busy ? <RefreshCw className="spin" size={17} /> : <Play size={16} />}Créer mon espace de
      démonstration
      <ArrowRight size={17} />
    </button>
  );
  if ((showDiscovery || !data) && view === 'assistant')
    return (
      <>
        <Toaster position="bottom-right" richColors />
        <Discovery
          busy={busy || offline}
          loading={loading}
          hasSession={Boolean(data)}
          error={
            offline
              ? 'Vous êtes hors connexion. Reconnectez-vous pour démarrer votre essai.'
              : lastError
          }
          theme={theme}
          mode={mode}
          onTheme={changeTheme}
          onStart={(reference) => void start(reference, true)}
          onResume={() => {
            setShowDiscovery(false);
            setView('assistant');
          }}
          onExplore={(next) => {
            setShowDiscovery(false);
            setView(next);
            setSearch('');
          }}
        />
      </>
    );
  return (
    <SidebarProvider style={{ '--sidebar-width': '244px' } as React.CSSProperties}>
      <Toaster position="bottom-right" richColors />
      <Sidebar className="atlas-sidebar" collapsible="offcanvas">
        <SidebarHeader className="brand-header">
          <button
            className="brand-home"
            aria-label="Revenir à l’accueil SAV SC Assistant AI"
            onClick={() => {
              setShowDiscovery(true);
              setView('assistant');
            }}
          >
            <Brand />
          </button>
          <span className="workspace-name">
            <span className="store-mark">M</span>Maison Atlas <span className="tag">FICTIF</span>
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>ESPACE DE TRAVAIL</SidebarGroupLabel>
            <SidebarMenu>
              {nav.slice(0, 3).map((n) => (
                <SidebarMenuItem key={n.id}>
                  <NavigationButton
                    isActive={view === n.id}
                    onClick={() => {
                      setView(n.id);
                      setSearch('');
                    }}
                    className="nav-item"
                  >
                    <n.icon />
                    <span>{n.label}</span>
                    {n.id === 'assistant' && <span className="nav-dot" />}
                    {n.id === 'dossiers' && data && (
                      <span className="nav-count">{data.cases.length}</span>
                    )}
                  </NavigationButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>DÉMONSTRATION</SidebarGroupLabel>
            <SidebarMenu>
              {nav.slice(3).map((n) => (
                <SidebarMenuItem key={n.id}>
                  <NavigationButton
                    isActive={view === n.id}
                    onClick={() => {
                      setView(n.id);
                      setSearch('');
                    }}
                    className="nav-item"
                  >
                    <n.icon />
                    <span>{n.label}</span>
                    {n.id === 'simulation' && data?.space.running && <span className="live-dot" />}
                  </NavigationButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <strong>Un espace rien qu’à vous</strong>
            <p>
              Données fictives, session isolée.
              <br />
              Aucune action réelle.
            </p>
          </div>
          <div className="sidebar-profile">
            <span className="avatar">{data ? 'DM' : 'V'}</span>
            <div>
              <strong>{data ? 'Mode démonstration' : 'Visiteur'}</strong>
              <small>{data ? 'Session de 24 heures' : 'Découvrez SAV SC Assistant AI'}</small>
            </div>
            <button
              className="icon-button"
              onClick={changeTheme}
              aria-label={'Thème actuel : ' + theme + '. Changer le thème.'}
            >
              {theme === 'dark' ? (
                <Moon size={17} />
              ) : theme === 'light' ? (
                <Sun size={17} />
              ) : (
                <CircleDot size={17} />
              )}
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-trigger" />
            <span>Plateforme</span>
            <ChevronRight size={13} />
            <strong>{nav.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className="demo-pill">
              <FlaskConical size={13} />
              Démonstration interactive
            </span>
            <a
              href="https://github.com/Simo-Mesbahi/spicial-agent"
              target="_blank"
              rel="noreferrer"
              className="github-link"
            >
              GitHub
              <ArrowUpRight size={15} />
            </a>
            <button className="icon-button" onClick={changeTheme} aria-label="Changer le thème">
              <Sun size={17} />
            </button>
          </div>
        </header>
        <main className={'main-content ' + (view === 'assistant' ? 'assistant-view' : '')}>
          {view === 'assistant' && (
            <>
              <div className="page-heading">
                <div>
                  <MiniLabel>SAV & SERVICE CLIENT</MiniLabel>
                  <h1>
                    Une question. Une réponse claire<span className="teal">.</span>
                  </h1>
                  <p>Vos demandes avancent. Gardez le fil, à chaque étape.</p>
                </div>
                <div
                  className="engine-status"
                  title={
                    data?.config.blockedReason ??
                    'Mode configuré côté serveur. Le mode utilisé figure sous chaque réponse.'
                  }
                >
                  <span className={data?.config.ready ? 'live-dot' : 'status-dot-muted'} />
                  <span>{modeLabel}</span>
                  <CircleHelp
                    size={14}
                    aria-label="Le mode utilisé est indiqué sous chaque réponse"
                  />
                </div>
              </div>
              {loading ? (
                <div className="loading-grid">
                  <Skeleton className="h-96 rounded-2xl" />
                  <Skeleton className="h-96 rounded-2xl" />
                </div>
              ) : (
                <>
                  {guideOpen && current && (
                    <section className="trial-guide" aria-label="Votre essai guidé">
                      <span className="trial-guide-number">{guide.step}</span>
                      <div className="trial-guide-copy">
                        <small>VOTRE ESSAI GUIDÉ</small>
                        <strong>{guide.title}</strong>
                        <p>{guide.body}</p>
                      </div>
                      <button
                        className="button secondary"
                        disabled={busy || sending}
                        onClick={followGuide}
                      >
                        {guide.cta}
                        <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Masquer le guide"
                        onClick={() => setGuideOpen(false)}
                      >
                        <X size={15} />
                      </button>
                    </section>
                  )}
                  <button
                    className="mobile-case-toggle"
                    aria-expanded={contextOpen}
                    aria-controls="case-context"
                    onClick={() => setContextOpen(!contextOpen)}
                  >
                    <KindIcon kind={current?.kind ?? 'repair'} size={18} />
                    <span>
                      <strong>{current?.product ?? 'Votre dossier'}</strong>
                      <small>
                        {currentVerified ? current?.status_label : 'Vérifier mon accès au dossier'}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <div className="assistant-grid" data-context-open={contextOpen}>
                    <section className="chat-panel">
                      {(offline || syncError || (data && !data.config.ready)) && (
                        <div className="connection-notice" role="status">
                          {offline ? <WifiOff size={17} /> : <AlertCircle size={17} />}
                          <span>
                            {offline
                              ? 'Hors connexion. Vos échanges restent visibles ; reconnectez-vous pour continuer.'
                              : syncError ||
                                'L’IA n’est pas encore configurée. Les dossiers restent accessibles.'}
                          </span>
                          {!offline && syncError && (
                            <button
                              className="text-button"
                              disabled={syncing || unavailable}
                              onClick={() => void refresh().catch(() => {})}
                            >
                              <RefreshCw size={14} className={syncing ? 'spin' : ''} /> Actualiser
                            </button>
                          )}
                        </div>
                      )}
                      <div className="chat-header">
                        <Brand small />
                        <div>
                          <strong>SAV SC Assistant AI</strong>
                          <small>
                            {currentVerified
                              ? 'Connecté au dossier ' + current?.reference
                              : 'À votre écoute · Questions générales'}
                          </small>
                        </div>
                        <span className="chat-header-badge">
                          <ShieldCheck size={13} />
                          {currentVerified ? 'Accès vérifié' : 'Accès protégé'}
                        </span>
                      </div>
                      {data && (
                        <div className="conversation-case-bar">
                          <label id="conversation-case-label">Votre dossier</label>
                          <Select
                            value={selectedId ?? ''}
                            disabled={busy || sending}
                            onValueChange={(id) => {
                              const chosen = data.cases.find((c) => c.id === id);
                              if (chosen) selectCase(chosen);
                            }}
                          >
                            <SelectTrigger
                              className="conversation-case-select"
                              aria-labelledby="conversation-case-label"
                            >
                              <SelectValue placeholder="Choisir un dossier" />
                            </SelectTrigger>
                            <SelectContent position="popper" className="conversation-case-options">
                              {data.cases.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.product} · {c.reference}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div
                        className="message-area"
                        ref={conversation}
                        role="log"
                        aria-live="polite"
                        aria-label="Conversation avec SAV SC Assistant AI"
                      >
                        {!messages.length && (
                          <div className="chat-welcome">
                            <span className="assistant-emblem">
                              <Sparkles size={25} />
                            </span>
                            <h2>Comment puis-je vous aider ?</h2>
                            <p>
                              {currentVerified
                                ? `Votre accès au dossier ${current?.reference} est vérifié. Je peux consulter son avancement et vous expliquer la suite.`
                                : 'Je vous accompagne pour vos réparations, livraisons et retours. Vérifiez un dossier pour obtenir un suivi personnalisé.'}
                            </p>
                            <div className="suggestions">
                              {questions.map((s, i) => (
                                <button
                                  disabled={unavailable || !data?.config.ready}
                                  key={s}
                                  onClick={() => send(s)}
                                >
                                  <span>
                                    {i === 0 ? (
                                      <Wrench size={16} />
                                    ) : i === 1 ? (
                                      <Package size={16} />
                                    ) : i === 2 ? (
                                      <Truck size={16} />
                                    ) : (
                                      <Headphones size={16} />
                                    )}
                                  </span>
                                  {s}
                                  <ArrowUpRight size={14} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {messages.map((m) => (
                          <div
                            key={m.id}
                            ref={m.id === messages.at(-1)?.id ? latestMessage : undefined}
                            className={'message ' + m.role}
                          >
                            {m.role === 'assistant' && <Brand small />}
                            <div className="message-content">
                              {m.role === 'assistant' &&
                              m.metadata.caseBrief &&
                              m.metadata.presentation === 'case_brief' ? (
                                <>
                                  <CaseReceipt
                                    brief={m.metadata.caseBrief}
                                    current={current}
                                    compact={m.id !== lastAnswer?.id}
                                    busy={busy || sending}
                                    onRefresh={() => void send('Où en est mon dossier ?')}
                                    onQuote={() =>
                                      current &&
                                      setConfirm({ action: 'accept_quote', case: current })
                                    }
                                  />
                                  <details className="answer-transcript">
                                    <summary>Lire la réponse complète</summary>
                                    <div className="message-bubble">{m.content}</div>
                                  </details>
                                </>
                              ) : (
                                <>
                                  <div className="message-bubble">{m.content}</div>
                                  {m.role === 'assistant' && m.metadata.caseBrief && (
                                    <CaseReceipt
                                      brief={m.metadata.caseBrief}
                                      current={current}
                                      compact={m.id !== lastAnswer?.id}
                                      busy={busy || sending}
                                      onRefresh={() => void send('Où en est mon dossier ?')}
                                      onQuote={() =>
                                        current &&
                                        setConfirm({ action: 'accept_quote', case: current })
                                      }
                                    />
                                  )}
                                </>
                              )}
                              {m.role === 'assistant' && (
                                <>
                                  {m.metadata.fallback && (
                                    <p className="response-notice" role="status">
                                      {m.metadata.fallback === 'daily_limit'
                                        ? 'Quota IA atteint.'
                                        : 'IA indisponible ou réponse non validée.'}{' '}
                                      Réponse de secours sans IA, à partir des règles et des données
                                      de démonstration.
                                    </p>
                                  )}
                                  {m.metadata.action === 'handoff' &&
                                    m.id === messages.at(-1)?.id &&
                                    currentVerified &&
                                    current && (
                                      <div className="reply-actions">
                                        <button
                                          className="button secondary reply-action"
                                          disabled={busy || sending}
                                          onClick={() =>
                                            setConfirm({ action: 'handoff', case: current })
                                          }
                                        >
                                          <Headphones size={15} /> Simuler le relais
                                        </button>
                                        <button
                                          className="button primary reply-action"
                                          onClick={() => setView('contact')}
                                        >
                                          <Mail size={15} /> Écrire par email
                                        </button>
                                      </div>
                                    )}
                                  <div className="message-sources">
                                    {m.metadata.sources?.map((s) => (
                                      <button
                                        key={s.id}
                                        onClick={() =>
                                          setArticle(knowledge.find((a) => a.id === s.id) ?? null)
                                        }
                                      >
                                        <BookOpen size={12} />
                                        {s.title}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="message-meta">
                                    <span>
                                      {m.metadata.fallback
                                        ? 'Secours sans IA'
                                        : m.metadata.mode === 'demo'
                                          ? 'Réponse déterministe'
                                          : 'Réponse générée'}{' '}
                                      · {dateTime(m.created_at)}
                                    </span>
                                    <button onClick={() => setTrace(m)}>
                                      <FileCheck2 size={12} />
                                      Sources & outils
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        {pendingMessage && pendingHere && (
                          <div className="message user">
                            <div className="message-content">
                              <div className="message-bubble">{pendingMessage}</div>
                            </div>
                          </div>
                        )}
                        {pendingHere && (
                          <div className="typing" role="status" aria-live="polite">
                            <Brand small />
                            <span>
                              {slowReply
                                ? 'La réponse prend un peu plus de temps. Votre question est en cours de traitement.'
                                : 'Consultation des informations'}
                              <span className="dots">…</span>
                            </span>
                          </div>
                        )}
                        {!!messages.length && !sending && (
                          <div className="quick-followups" aria-label="Continuer la conversation">
                            {questions.map((question) => (
                              <button
                                disabled={unavailable || !data?.config.ready}
                                key={question}
                                onClick={() => send(question)}
                              >
                                {question}
                                <ArrowUpRight size={12} />
                              </button>
                            ))}
                          </div>
                        )}
                        {lastError && (
                          <div ref={conversationError} role="alert" className="inline-error">
                            {lastError}
                          </div>
                        )}
                      </div>
                      {currentVerified && current?.status === 'quote_pending' && (
                        <div className="action-strip">
                          <FileText size={17} />
                          <span>
                            Devis en attente :{' '}
                            <strong>
                              {validAmount(current.quote_cents)
                                ? money(current.quote_cents)
                                : 'montant à confirmer'}
                            </strong>
                          </span>
                          <button
                            className="text-button"
                            disabled={unavailable}
                            onClick={() => setConfirm({ action: 'accept_quote', case: current })}
                          >
                            Examiner le devis
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                      <form
                        className="composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          send();
                        }}
                      >
                        <textarea
                          aria-label="Votre message"
                          placeholder="Posez votre question…"
                          rows={2}
                          maxLength={1500}
                          enterKeyHint="send"
                          readOnly={sending}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              send();
                            }
                          }}
                        />
                        <div className="composer-bottom">
                          <span>
                            <LockKeyhole size={12} />
                            Ne partagez aucun code ou secret ici.
                          </span>
                          <button
                            className="send-button"
                            type="submit"
                            disabled={unavailable || !input.trim() || !data?.config.ready}
                            aria-label="Envoyer le message"
                          >
                            <ArrowRight size={19} />
                          </button>
                        </div>
                      </form>
                      <p className="chat-disclaimer">
                        {mode === 'demo'
                          ? 'Mode démonstration : règles et documents, sans modèle génératif.'
                          : mode === 'gemini'
                            ? 'Mode Gemini gratuit : utilisez uniquement des données fictives ; ne partagez aucun code, paiement ou renseignement personnel.'
                            : 'Les réponses générées peuvent contenir des erreurs. Vérifiez les informations importantes.'}
                      </p>
                    </section>
                    <aside className="context-panel" id="case-context">
                      <div className="context-top">
                        <MiniLabel>VOTRE CONTEXTE</MiniLabel>
                        <button
                          className="icon-button"
                          aria-label="Actualiser les dossiers"
                          title="Actualiser les dossiers"
                          disabled={syncing || unavailable}
                          onClick={() => refresh().catch((e) => toast.error(e.message))}
                        >
                          <RefreshCw size={15} className={syncing ? 'spin' : ''} />
                        </button>
                      </div>
                      <h3>
                        Le bon dossier.
                        <br />
                        La bonne information.
                      </h3>
                      <button className="case-picker" onClick={() => setView('dossiers')}>
                        <span className="product-icon">
                          <KindIcon kind={current?.kind ?? 'repair'} />
                        </span>
                        <span>
                          <strong>{current?.product}</strong>
                          <small>{current?.reference}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                      {current && !currentVerified ? (
                        <>
                          <div className="access-card">
                            <LockKeyhole size={22} />
                            <h4>Votre dossier est protégé</h4>
                            <p>
                              Vérifiez votre référence et votre code pour accéder au suivi
                              personnalisé.
                            </p>
                            <button
                              className="button primary full"
                              onClick={() => openVerify(current)}
                            >
                              Vérifier mon accès
                              <ArrowRight size={15} />
                            </button>
                          </div>
                          <details className="demo-credentials">
                            <summary>
                              <FlaskConical size={14} />
                              Identifiants de ce scénario
                            </summary>
                            <p>Ces identifiants sont fictifs et propres à votre espace.</p>
                            <div>
                              <span>Référence</span>
                              <code>{current.reference}</code>
                            </div>
                            <div>
                              <span>Code de démonstration</span>
                              <code>{current.demoCode}</code>
                            </div>
                          </details>
                        </>
                      ) : (
                        current && (
                          <>
                            <div className="context-status">
                              <Status status={current.status} />
                              <p>{current.description}</p>
                            </div>
                            <div className="facts">
                              <div>
                                <span>Prise en charge</span>
                                <strong>{current.warranty}</strong>
                              </div>
                              <div>
                                <span>Restitution</span>
                                <strong>{current.delivery_mode}</strong>
                              </div>
                              <div>
                                <span>Estimation</span>
                                <strong>{current.estimate ?? 'Non communiquée'}</strong>
                              </div>
                            </div>
                            <MiniLabel>DERNIÈRES ÉTAPES</MiniLabel>
                            <div className="timeline">
                              {data?.events
                                .filter((e) => e.case_id === current.id)
                                .slice(0, 4)
                                .map((e, i) => (
                                  <div
                                    className={'timeline-item ' + (i === 0 ? 'current' : '')}
                                    key={e.id}
                                  >
                                    <span className="timeline-dot">
                                      {i === 0 ? <CircleDot size={15} /> : <Check size={12} />}
                                    </span>
                                    <div>
                                      <strong>{e.label}</strong>
                                      <small>{dateTime(e.created_at)}</small>
                                    </div>
                                  </div>
                                ))}
                            </div>
                            <div className="context-contact-actions">
                              <button
                                className="button secondary full"
                                disabled={busy}
                                onClick={() => setConfirm({ action: 'handoff', case: current })}
                              >
                                <Headphones size={16} />
                                Simuler le relais conseiller
                              </button>
                              <button
                                className="button primary full"
                                onClick={() => setView('contact')}
                              >
                                <Mail size={16} />
                                Contacter par email
                              </button>
                            </div>
                          </>
                        )
                      )}
                      <div className="context-tip">
                        <Zap size={17} />
                        <p>
                          Faites avancer ce dossier dans le{' '}
                          <button onClick={() => setView('simulation')}>laboratoire</button>, puis
                          reposez votre question.
                        </p>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              <div className="trust-footer">
                <span>
                  <Database size={13} />
                  Données métier actualisées
                </span>
                <span>
                  <BookOpen size={13} />
                  Procédures sourcées
                </span>
                <span>
                  <ShieldCheck size={13} />
                  Actions sous contrôle
                </span>
              </div>
            </>
          )}
          {view === 'dossiers' && (
            <>
              <SectionTitle
                label="ESPACE CLIENT"
                title="Vos dossiers, au même endroit."
                description="Choisissez une situation à explorer. Les données et identités sont entièrement fictives."
                action={
                  data ? (
                    <button
                      className="button secondary"
                      onClick={() => refresh().catch((e) => toast.error(e.message))}
                    >
                      <RefreshCw size={15} />
                      Actualiser
                    </button>
                  ) : (
                    beginButton
                  )
                }
              />
              {!data ? (
                <Empty
                  icon={<FileText />}
                  title="Votre espace vous attend"
                  text="Démarrez la démonstration pour créer vos huit premiers dossiers."
                />
              ) : (
                <>
                  <div className="metrics-row">
                    <Metric
                      value={String(data.cases.length)}
                      label="Dossiers dans votre espace"
                      icon={<FileText />}
                    />
                    <Metric
                      value={String(data.cases.filter((c) => !finished(c.status)).length)}
                      label="En cours de traitement"
                      icon={<Clock3 />}
                    />
                    <Metric
                      value={String(data.cases.filter((c) => c.status === 'quote_pending').length)}
                      label="Votre accord est nécessaire"
                      icon={<FileCheck2 />}
                    />
                  </div>
                  <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder="Rechercher un produit, un dossier ou un client…"
                  />
                  <div className="case-grid">
                    {filtered.map((c) => (
                      <article
                        className={'case-card ' + (c.id === selectedId ? 'selected' : '')}
                        key={c.id}
                      >
                        <div className="case-card-top">
                          <span className="product-icon">
                            <KindIcon kind={c.kind} />
                          </span>
                          <span className="kind-label">{kindLabels[c.kind]}</span>
                          <Status status={c.status} />
                        </div>
                        <h3>{c.product}</h3>
                        <p className="mono">{c.reference}</p>
                        <p className="case-description">{c.description}</p>
                        <div className="case-card-footer">
                          <span>
                            {c.customer}
                            <small>{c.store}</small>
                          </span>
                          <button
                            className="icon-circle"
                            aria-label={'Ouvrir ' + c.reference}
                            disabled={busy || sending}
                            onClick={() => selectCase(c)}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!filtered.length && (
                    <Empty
                      icon={<Search />}
                      title="Aucun dossier trouvé"
                      text="Essayez un autre terme."
                    />
                  )}
                </>
              )}
            </>
          )}
          {view === 'operations' && (
            <>
              <SectionTitle
                label="ESPACE CONSEILLER · RÔLE SIMULÉ"
                title="Une vue claire pour agir."
                description="Faites avancer les dossiers et retrouvez les demandes transmises par l’assistant."
              />
              <div className="notice">
                <ShieldCheck size={17} />
                Vous gérez uniquement les dossiers fictifs de votre session. Cet espace n’est pas
                une authentification de salarié.
              </div>
              {!data ? (
                beginButton
              ) : (
                <Tabs defaultValue="cases">
                  <TabsList className="atlas-tabs">
                    <TabsTrigger value="cases">Dossiers SAV / SC</TabsTrigger>
                    <TabsTrigger value="handoffs">
                      Demandes de contact <span className="count">{data.handoffs.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="audit">Journal d’activité</TabsTrigger>
                  </TabsList>
                  <TabsContent value="cases">
                    <div className="panel table-panel">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Dossier / Produit</TableHead>
                            <TableHead>Client fictif</TableHead>
                            <TableHead>État actuel</TableHead>
                            <TableHead>Dernière mise à jour</TableHead>
                            <TableHead>Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.cases.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell>
                                <strong>{c.product}</strong>
                                <small className="block mono">{c.reference}</small>
                              </TableCell>
                              <TableCell>
                                {c.customer}
                                <small className="block">{c.city}</small>
                              </TableCell>
                              <TableCell>
                                <Status status={c.status} />
                              </TableCell>
                              <TableCell>{dateTime(c.updated_at)}</TableCell>
                              <TableCell>
                                {nextStep(c.kind, c.status) ? (
                                  <button
                                    className="button small secondary"
                                    disabled={busy}
                                    onClick={() => action(c, 'advance')}
                                  >
                                    Étape suivante
                                    <ChevronRight size={13} />
                                  </button>
                                ) : (
                                  <span className="quiet">
                                    {c.status === 'quote_pending'
                                      ? 'Accord client requis'
                                      : 'Aucune étape automatique'}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  <TabsContent value="handoffs">
                    {!data.handoffs.length ? (
                      <Empty
                        icon={<Headphones />}
                        title="Aucune demande en attente"
                        text="Depuis un dossier vérifié, demandez un conseiller puis confirmez le transfert simulé."
                      />
                    ) : (
                      <div className="handoff-grid">
                        {data.handoffs.map((h) => (
                          <article className="panel handoff" key={h.id}>
                            <span className="status warning">
                              <i />À examiner
                            </span>
                            <h3>Demande de contact</h3>
                            <p className="quiet">{dateTime(h.created_at)}</p>
                            <pre>{h.summary}</pre>
                            <span className="footnote">
                              Enregistrée localement dans votre espace. Aucun envoi automatique.
                            </span>
                          </article>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  <TabsContent value="audit">
                    <div className="panel audit-list">
                      {data.logs.length ? (
                        data.logs.map((l, i) => (
                          <div className="audit-item" key={i}>
                            <Activity size={16} />
                            <div>
                              <strong>{l.detail}</strong>
                              <small>{l.action}</small>
                            </div>
                            <time>{dateTime(l.created_at)}</time>
                          </div>
                        ))
                      ) : (
                        <Empty
                          icon={<Activity />}
                          title="Votre historique commence ici"
                          text="Les consultations et actions apparaîtront dans ce journal, sans les codes secrets."
                        />
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}
          {view === 'simulation' && (
            <>
              <SectionTitle
                label="LABORATOIRE INTERACTIF"
                title="Faites vivre le service client."
                description="Un système fictif, des événements cohérents, des réponses qui suivent la réalité des dossiers."
              />
              {!data ? (
                beginButton
              ) : (
                <>
                  <div className="lab-grid">
                    <section className="panel lab-controls">
                      <div className="lab-title">
                        <span className="lab-icon">
                          <FlaskConical size={27} />
                        </span>
                        <div>
                          <h3>Simulateur d’activité</h3>
                          <p>Vous avez les commandes.</p>
                        </div>
                      </div>
                      <div className="switch-row">
                        <div>
                          <strong>Progression automatique</strong>
                          <small>
                            Un événement éligible toutes les 20 secondes de consultation.
                          </small>
                        </div>
                        <Switch
                          checked={data.space.running}
                          disabled={busy}
                          onCheckedChange={(checked) => simulate('toggle', { running: checked })}
                          aria-label="Activer la simulation automatique"
                        />
                      </div>
                      <p className="footnote">
                        L’horloge est évaluée à chaque requête. Aucun processus ne tourne en
                        permanence lorsque la plateforme n’est pas consultée.
                      </p>
                      <div className="lab-buttons">
                        <button
                          disabled={busy}
                          className="button primary"
                          onClick={() => simulate('tick')}
                        >
                          <Play size={16} />
                          Simuler une étape
                        </button>
                        <button
                          disabled={busy || data.cases.length >= 24}
                          className="button secondary"
                          onClick={() => simulate('generate')}
                        >
                          <Plus size={16} />
                          Générer un dossier
                        </button>
                      </div>
                      <div className="simulation-count">
                        <span>{data.space.tick.toString().padStart(2, '0')}</span>
                        <div>
                          cycles déclenchés<small>dans votre espace personnel</small>
                        </div>
                      </div>
                      <button
                        className="danger-link"
                        disabled={busy}
                        onClick={() => setReset(true)}
                      >
                        <RefreshCw size={14} />
                        Réinitialiser mon espace
                      </button>
                    </section>
                    <section className="panel lab-explain">
                      <MiniLabel>ESSAYEZ CE PARCOURS</MiniLabel>
                      <h3>
                        Du diagnostic
                        <br />à la réponse du chatbot.
                      </h3>
                      {[
                        'Vérifiez un dossier depuis l’assistant.',
                        'Posez la question « Où en est ma réparation ? ».',
                        'Faites avancer son état dans l’espace conseiller.',
                        'Reposez la question et comparez la réponse.',
                      ].map((s, i) => (
                        <div className="guide-step" key={s}>
                          <span>{i + 1}</span>
                          <p>{s}</p>
                        </div>
                      ))}
                      <button className="text-button" onClick={() => setView('assistant')}>
                        Ouvrir l’assistant
                        <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                  <div className="section-row">
                    <h3>Flux d’événements</h3>
                    <span className="quiet">
                      {data.space.running ? 'Actualisation automatique' : 'Simulation en pause'}
                    </span>
                  </div>
                  <div className="panel event-feed">
                    {data.events.slice(0, 15).map((e) => (
                      <div className="feed-row" key={e.id}>
                        <span className="event-mark">
                          <Check size={13} />
                        </span>
                        <div>
                          <strong>{e.label}</strong>
                          <small>
                            {data.cases.find((c) => c.id === e.case_id)?.reference} · {e.actor}
                          </small>
                        </div>
                        <time>{dateTime(e.created_at)}</time>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {view === 'knowledge' && (
            <>
              <SectionTitle
                label="BASE DOCUMENTAIRE"
                title="Des réponses qui ont une source."
                description="Procédures de l’enseigne fictive Maison Atlas. Versionnées, consultables et utilisées par l’assistant."
              />
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Rechercher : garantie, retour, devis…"
              />
              <div className="knowledge-grid">
                {knowledge
                  .filter((a) =>
                    normalized(a.title + ' ' + a.tags + ' ' + a.body).includes(normalized(search)),
                  )
                  .map((a) => (
                    <button className="document-card" key={a.id} onClick={() => setArticle(a)}>
                      <div>
                        <span className="document-icon">
                          <BookOpen size={21} />
                        </span>
                        <span className="tag">{a.category}</span>
                      </div>
                      <h3>{a.title}</h3>
                      <p>{a.body}</p>
                      <footer>
                        <span>
                          Version {a.version} · {a.effective}
                        </span>
                        <ArrowUpRight size={17} />
                      </footer>
                    </button>
                  ))}
              </div>
              {!knowledge.some((a) =>
                normalized(a.title + ' ' + a.tags + ' ' + a.body).includes(normalized(search)),
              ) && (
                <Empty
                  icon={<Search />}
                  title="Aucun document trouvé"
                  text="Essayez garantie, retour, livraison ou devis."
                />
              )}
              <div className="notice">
                <CircleHelp size={17} />
                Corpus fictif validé dans le code. Recherche lexicale ; ces documents ne constituent
                pas des conditions commerciales ou un avis juridique réels.
              </div>
            </>
          )}
          {view === 'contact' && <ContactPage />}
          {view === 'project' && (
            <>
              <SectionTitle
                label="SAV SC ASSISTANT AI · PROJET DE DÉMONSTRATION"
                title="Conçu pour expliquer. Bâti pour vérifier."
                description="Une plateforme SAV et service client qui relie conversation, documents et données métier."
                action={
                  <a
                    className="button secondary"
                    href="https://github.com/Simo-Mesbahi/spicial-agent"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Dépôt du projet
                    <ArrowUpRight size={16} />
                  </a>
                }
              />
              <div className="project-hero">
                <MiniLabel>UNE ARCHITECTURE, DES RESPONSABILITÉS CLAIRES</MiniLabel>
                <h2>
                  Le modèle dialogue.
                  <br />
                  Le système contrôle.
                </h2>
                <p>
                  L’assistant consulte des outils limités. L’API vérifie les accès, les
                  confirmations et les transitions. Les dossiers et les documents restent
                  indépendants du fournisseur de modèle.
                </p>
                <div className="architecture-pills">
                  <span>
                    <MessageSquareText />
                    Conversation
                  </span>
                  <ChevronRight />
                  <span>
                    <ShieldCheck />
                    API sécurisée
                  </span>
                  <ChevronRight />
                  <span>
                    <Database />
                    Données métier
                  </span>
                </div>
              </div>
              <div className="notice">
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {data?.config.budgetMode === 'approved'
                      ? 'Fournisseur externe autorisé par configuration serveur'
                      : 'Budget IA 0 € · Fournisseurs externes bloqués'}
                  </strong>
                  <p>
                    La démo publique n’appelle aucun LLM par défaut. Un vrai modèle peut fonctionner
                    avec Ollama sur votre ordinateur, sans clé API. Le matériel, l’électricité et
                    l’hébergement ne sont pas inclus dans cette politique de frais d’API.
                  </p>
                  <a
                    className="text-button"
                    href="https://github.com/Simo-Mesbahi/spicial-agent/blob/main/docs/ZERO-BUDGET.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Démarrer l’IA locale <ArrowUpRight size={14} />
                  </a>
                </div>
              </div>
              <div className="project-grid">
                {[
                  {
                    icon: ShieldCheck,
                    title: 'Sécurité par défaut',
                    text: 'Cookie HttpOnly, vérification par dossier, contrôle des versions, confirmation des devis et protection contre les doublons.',
                  },
                  {
                    icon: BookOpen,
                    title: 'Des sources explicites',
                    text: 'Procédures fictives versionnées. Recherche lexicale indépendante. Les sources et les outils consultés sont visibles pour chaque réponse.',
                  },
                  {
                    icon: FlaskConical,
                    title: 'Une démonstration isolée',
                    text: 'Huit scénarios initiaux, génération de dossiers et progression contrôlée. Votre session est indépendante de celle des autres visiteurs.',
                  },
                  {
                    icon: Bot,
                    title: 'Le choix du modèle, sans surprise',
                    text: 'Démo déterministe en ligne et connecteur Ollama local sans clé API. Les fournisseurs externes sont bloqués par défaut. Le mode actif reste visible.',
                  },
                ].map((x) => (
                  <article className="panel project-card" key={x.title}>
                    <x.icon size={23} />
                    <h3>{x.title}</h3>
                    <p>{x.text}</p>
                  </article>
                ))}
              </div>
              <div className="section-row">
                <h3>Mesures de votre session</h3>
                <span className="quiet">Données observées, sans score inventé</span>
              </div>
              <div className="metrics-row">
                <Metric
                  value={String(answered.length)}
                  label="Réponses enregistrées"
                  icon={<MessageSquareText />}
                />
                <Metric
                  value={latency === null ? '—' : latency + ' ms'}
                  label="Durée moyenne du traitement"
                  icon={<Clock3 />}
                />
                <Metric
                  value={String(
                    answered.reduce(
                      (s, m) => s + (m.metadata.inputTokens ?? 0) + (m.metadata.outputTokens ?? 0),
                      0,
                    ),
                  )}
                  label="Tokens signalés par le fournisseur"
                  icon={<Zap />}
                />
              </div>
              <div className="notice limits">
                <CircleHelp size={19} />
                <div>
                  <strong>Ce que cette version ne prétend pas faire</strong>
                  <p>
                    Aucune connexion à une enseigne réelle, aucun remboursement ou envoi
                    automatique. Le mode sans LLM est déterministe. La recherche n’utilise pas
                    encore d’index vectoriel. Les accès salariés, la supervision permanente et
                    l’évaluation comparative des modèles nécessitent une intégration de production.
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            SAV SC Assistant AI <span className="footer-sep">/</span> Une démonstration par Simo
            Mesbahi
          </span>
          <span>Données fictives · v0.1</span>
        </footer>
      </div>
      <Dialog
        open={!!verify}
        onOpenChange={(v) => {
          if (!v) {
            setVerify(null);
            setCode('');
          }
        }}
      >
        <DialogContent className="atlas-dialog">
          <DialogHeader>
            <span className="dialog-icon">
              <LockKeyhole size={24} />
            </span>
            <DialogTitle>Accéder à votre dossier</DialogTitle>
            <DialogDescription>
              {consultAfterVerify
                ? 'Utilisez le code de démonstration ci-dessous pour vérifier votre accès et consulter le suivi.'
                : 'La vérification est effectuée côté serveur. Votre code n’est pas envoyé au modèle.'}
            </DialogDescription>
          </DialogHeader>
          <div className="verify-product">
            <span className="product-icon">
              <KindIcon kind={verify?.kind ?? 'repair'} />
            </span>
            <div>
              <strong>{verify?.product}</strong>
              <small>{verify?.reference} · Dossier fictif</small>
            </div>
          </div>
          <form onSubmit={doVerify} className="verify-form">
            <label>
              Référence du dossier
              <input
                value={refValue}
                onChange={(e) => setRefValue(e.target.value)}
                autoComplete="off"
                required
                maxLength={60}
              />
            </label>
            <label>Code d’accès</label>
            <InputOTP
              maxLength={6}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Code d’accès à six chiffres"
            >
              <InputOTPGroup>
                {Array.from({ length: 6 }, (_, i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            {verifyError && (
              <div className="inline-error" role="alert">
                {verifyError}
              </div>
            )}
            <div className="demo-code-hint">
              <FlaskConical size={16} />
              <span>
                Pour ce scénario fictif : <strong>{verify?.demoCode}</strong>
              </span>
              <button type="button" onClick={() => setCode(verify?.demoCode ?? '')}>
                Utiliser ce code
              </button>
            </div>
            <button
              className="button primary full"
              disabled={busy || code.length !== 6}
              type="submit"
            >
              {busy
                ? 'Vérification…'
                : consultAfterVerify
                  ? 'Vérifier et consulter le dossier'
                  : 'Vérifier mon accès'}
              <ShieldCheck size={16} />
            </button>
          </form>
          <p className="footnote">
            Le code reste dans le formulaire sécurisé. Ne saisissez aucune donnée personnelle
            réelle.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!article} onOpenChange={(v) => !v && setArticle(null)}>
        <DialogContent className="atlas-dialog">
          <DialogHeader>
            <span className="dialog-icon">
              <BookOpen size={24} />
            </span>
            <DialogTitle>{article?.title}</DialogTitle>
            <DialogDescription>
              Maison Atlas · Document fictif · Version {article?.version}
            </DialogDescription>
          </DialogHeader>
          <p className="article-body">{article?.body}</p>
          <p className="footnote">
            Date d’application simulée : {article?.effective}. Aucune valeur contractuelle réelle.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!trace} onOpenChange={(v) => !v && setTrace(null)}>
        <DialogContent className="atlas-dialog">
          <DialogHeader>
            <DialogTitle>Les éléments de cette réponse</DialogTitle>
            <DialogDescription>
              Sources et opérations observables. Aucun raisonnement interne ni secret n’est affiché.
            </DialogDescription>
          </DialogHeader>
          <div className="facts">
            {trace?.metadata.fallback && (
              <div>
                <span>Continuité de service</span>
                <strong>
                  {trace.metadata.fallback === 'daily_limit'
                    ? 'Quota IA atteint : secours sans IA'
                    : 'Réponse du modèle indisponible ou non validée : secours sans IA'}
                </strong>
              </div>
            )}
            <div>
              <span>Moteur</span>
              <strong>
                {trace?.metadata.mode === 'demo' ? 'Déterministe, sans LLM' : trace?.metadata.mode}
              </strong>
            </div>
            <div>
              <span>Temps de traitement</span>
              <strong>{trace?.metadata.latencyMs} ms</strong>
            </div>
            {trace?.metadata.caseVersion != null && (
              <div>
                <span>Version du dossier consultée</span>
                <strong>{trace.metadata.caseVersion}</strong>
              </div>
            )}
            <div>
              <span>Outils</span>
              <strong>{trace?.metadata.tools?.join(', ') || 'Aucun'}</strong>
            </div>
          </div>
          {trace?.metadata.sources?.map((s) => (
            <button
              className="source-link"
              key={s.id}
              onClick={() => {
                setTrace(null);
                setArticle(knowledge.find((a) => a.id === s.id) ?? null);
              }}
            >
              <BookOpen size={16} />
              {s.title}
              <ArrowUpRight size={14} />
            </button>
          ))}
          <p className="footnote">
            Les faits de dossier proviennent de votre espace simulé. L’absence de source
            documentaire n’implique pas une vérification externe.
          </p>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="atlas-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.action === 'handoff'
                ? 'Transmettre une demande de contact ?'
                : confirm?.action === 'decline_quote'
                  ? 'Refuser ce devis ?'
                  : validAmount(confirm?.case.quote_cents)
                    ? 'Accepter le devis de ' + money(confirm.case.quote_cents) + ' ?'
                    : 'Le montant du devis doit être confirmé'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.case.reference} · {confirm?.case.product}.{' '}
              {confirm?.action === 'handoff'
                ? 'Le résumé et les derniers échanges seront ajoutés à l’espace conseiller de votre démonstration. Aucun email ni SMS ne sera envoyé.'
                : 'Cette décision modifie le dossier fictif. Aucun paiement réel ne sera effectué. Le serveur vérifiera que le devis n’a pas changé.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.action === 'accept_quote' && !validAmount(confirm.case.quote_cents) && (
            <p className="inline-error" role="alert">
              Aucun montant valide n’est enregistré. Contactez un conseiller avant d’accepter.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            {confirm?.action === 'accept_quote' && (
              <button
                className="button secondary"
                onClick={() => setConfirm({ ...confirm, action: 'decline_quote' })}
              >
                Refuser plutôt
              </button>
            )}
            <AlertDialogAction
              disabled={
                unavailable ||
                (confirm?.action === 'accept_quote' && !validAmount(confirm.case.quote_cents))
              }
              onClick={() => confirm && action(confirm.case, confirm.action, true)}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={reset} onOpenChange={setReset}>
        <AlertDialogContent className="atlas-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Réinitialiser votre démonstration ?</AlertDialogTitle>
            <AlertDialogDescription>
              Vos dossiers fictifs, conversations et événements seront supprimés. Vous pourrez créer
              un nouvel espace. Les autres visiteurs ne seront pas affectés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver mon espace</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={clear}>
              Supprimer mon espace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
function SectionTitle({
  label,
  title,
  description,
  action,
}: {
  label: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading section-title">
      <div>
        <MiniLabel>{label}</MiniLabel>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      <span className="metric-icon">{icon}</span>
    </div>
  );
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="icon-button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
