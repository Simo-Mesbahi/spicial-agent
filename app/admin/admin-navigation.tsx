'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Activity, SlidersHorizontal, ArrowUpRight, LogOut, ShieldCheck, Library } from 'lucide-react';
import { productionRequest } from '@/lib/atlas/production-client';
import { ADMIN_LOGOUT_EVENT, ADMIN_SESSION_STATE_EVENT } from '@/lib/atlas/admin-session';

export default function AdminNavigation() {
  const path = usePathname();
  const [environment, setEnvironment] = useState('Vérification…');
  const [sessionActive, setSessionActive] = useState(false);

  useEffect(() => {
    let active = true;
    void productionRequest<{environment: string}>('/config')
      .then(result => { if (active) setEnvironment(result.environment ?? 'NON CONFIGURÉ'); })
      .catch(() => { if (active) setEnvironment('ENVIRONNEMENT INDISPONIBLE'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setSessionActive(Boolean(detail?.active));
    };
    window.addEventListener(ADMIN_SESSION_STATE_EVENT, onState);
    return () => window.removeEventListener(ADMIN_SESSION_STATE_EVENT, onState);
  }, []);

  const links = [
    { href: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
    { href: '/admin/operations', label: 'Opérations', icon: Activity },
    { href: '/admin/knowledge', label: 'Connaissances', icon: Library },
    { href: '/admin/performance', label: 'Performance & réglages', icon: SlidersHorizontal },
  ];

  return <header className="admin-workspace-nav">
    <div className="admin-workspace-brand">
      <strong>SAV SC <span>Administration</span></strong>
      <span className="admin-environment" title="Environnement défini côté serveur">{environment}</span>
      {sessionActive && <span className="admin-session-badge" title="Verrouillage automatique après 15 minutes d’inactivité"><ShieldCheck size={13}/>Session protégée · 15 min</span>}
    </div>
    <nav aria-label="Sections de l’administration">
      {links.map(({href,label,icon:Icon}) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}><Icon size={17}/>{label}</a>)}
    </nav>
    <div className="admin-workspace-actions">
      <a className="admin-client-link" href="/file">Espace client <ArrowUpRight size={15}/></a>
      {sessionActive && <button type="button" className="admin-global-logout" onClick={() => window.dispatchEvent(new Event(ADMIN_LOGOUT_EVENT))}><LogOut size={16}/>Déconnexion</button>}
    </div>
  </header>;
}
