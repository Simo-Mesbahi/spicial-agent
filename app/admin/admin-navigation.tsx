'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Activity, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import { productionRequest } from '@/lib/atlas/production-client';

export default function AdminNavigation() {
  const path = usePathname();
  const [environment, setEnvironment] = useState('Vérification…');
  useEffect(() => { let active = true; void productionRequest<{environment: string}>('/config')
    .then(result => { if (active) setEnvironment(result.environment ?? 'NON CONFIGURÉ'); })
    .catch(() => { if (active) setEnvironment('ENVIRONNEMENT INDISPONIBLE'); }); return () => { active = false; }; }, []);
  const links = [{ href: '/admin', label: 'Vue d’ensemble', icon: LayoutDashboard },
    { href: '/admin/operations', label: 'Opérations', icon: Activity },
    { href: '/admin/performance', label: 'Performance & réglages', icon: SlidersHorizontal }];
  return <header className="admin-workspace-nav">
    <div className="admin-workspace-brand"><strong>SAV SC <span>Administration</span></strong><span className="admin-environment" title="Environnement défini côté serveur">{environment}</span></div>
    <nav aria-label="Sections de l’administration">{links.map(({href,label,icon:Icon}) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}><Icon size={17}/>{label}</a>)}</nav>
    <a className="admin-client-link" href="/file">Espace client <ArrowUpRight size={15}/></a>
  </header>;
}
