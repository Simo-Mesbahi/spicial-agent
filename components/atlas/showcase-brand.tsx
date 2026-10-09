import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export function ShowcaseBrand() {
  return (
    <Link className="showcase-brand" href="/" aria-label="SAV SC Assistant AI — accueil">
      <span className="showcase-brand-mark" aria-hidden="true">
        <Sparkles size={19} />
      </span>
      <span>SAV SC Assistant AI</span>
    </Link>
  );
}
