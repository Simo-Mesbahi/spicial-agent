'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  FileCheck2,
  LockKeyhole,
  Mail,
  Moon,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Sun,
  Truck,
  Wrench,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { discoveryScenarios } from '@/lib/atlas/experience';
import { labels, scenarios } from '@/lib/atlas/domain';

type Props = {
  busy: boolean;
  loading: boolean;
  hasSession: boolean;
  error: string;
  theme: string;
  onTheme: () => void;
  onStart: (reference?: string) => void;
  onResume: () => void;
  onContact: () => void;
};

export function Discovery({
  busy,
  loading,
  hasSession,
  error,
  theme,
  onTheme,
  onStart,
  onResume,
  onContact,
}: Props) {
  const [selected, setSelected] = useState('0');
  const [advanced, setAdvanced] = useState(false);
  const choice = discoveryScenarios[Number(selected)] ?? discoveryScenarios[0];
  const scenario = scenarios.find((s) => s.reference === choice.reference)!;
  const Icon = selected === '0' ? Wrench : selected === '1' ? Truck : FileCheck2;
  const unavailable = busy || loading;
  return (
    <div className="discovery-page">
      <a className="skip-link" href="#discovery-main">
        Aller au contenu
      </a>
      <header className="discovery-nav discovery-container">
        <a href="#" className="discovery-brand" aria-label="SAV SC Assistant AI, accueil">
          <span className="brand-symbol">
            <Sparkles size={22} />
          </span>
          <span>
            SAV SC <span className="brand-light">Assistant</span>
            <sup>AI</sup>
          </span>
        </a>
        <nav aria-label="Découvrir SAV SC Assistant AI">
          <a href="#try-atlas">L’expérience</a>
          <a href="#how-atlas">Comment ça marche</a>
          <button onClick={onContact}>
            Nous contacter <Mail size={13} />
          </button>
        </nav>
        <div className="discovery-nav-actions">
          <button
            className="icon-button"
            onClick={onTheme}
            aria-label={'Changer le thème. Thème actuel : ' + theme}
          >
            {theme === 'dark' ? (
              <Moon size={18} />
            ) : theme === 'light' ? (
              <Sun size={18} />
            ) : (
              <CircleDot size={18} />
            )}
          </button>
          <button
            className="discovery-nav-cta"
            disabled={unavailable}
            onClick={() => (hasSession ? onResume() : onStart(choice.reference))}
          >
            {hasSession ? 'Reprendre' : 'Essayer'}
            <ArrowUpRight size={15} />
          </button>
        </div>
      </header>

      <main id="discovery-main">
        <section className="discovery-hero discovery-container" aria-labelledby="discovery-title">
          <div className="discovery-intro">
            <div className="discovery-eyebrow">
              <span /> LE SERVICE CLIENT, PLUS CLAIR.
            </div>
            <h1 id="discovery-title">
              Moins de flou.
              <br />
              Plus de <span>réponses.</span>
            </h1>
            <p className="discovery-lead">
              Un produit en réparation. Une livraison qui tarde. Une question qui mérite mieux qu’un
              « patientez ».
            </p>
            <p className="discovery-sublead">
              Où en est votre dossier ? Quelle est la suite ? Que devez-vous faire ? Trois réponses
              réunies dans un suivi clair, que vous pouvez faire évoluer pendant l’essai.
            </p>
            <div className="discovery-hero-actions">
              <button
                className="discovery-primary"
                disabled={unavailable}
                onClick={() => onStart(choice.reference)}
              >
                {busy ? <RefreshCw size={18} className="spin" /> : <Play size={17} />}
                {busy ? 'Votre démo se prépare…' : 'Vivre l’expérience'}
                <ArrowRight size={18} />
              </button>
              <a href="#try-atlas" className="discovery-text-link">
                Voir un exemple <ArrowDown size={15} />
              </a>
            </div>
            <div className="discovery-assurances">
              <span>
                <Check size={14} /> Sans inscription
              </span>
              <span>
                <Check size={14} /> Dossiers fictifs
              </span>
              <span>
                <Check size={14} /> Parcours guidé
              </span>
            </div>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="discovery-mode">
              <ShieldCheck size={14} />
              Environnement de démonstration. N’utilisez aucune donnée personnelle réelle.
            </div>
          </div>

          <div className="discovery-stage" id="try-atlas">
            <div className="stage-caption">
              <span>PRENEZ LA PLACE DU CLIENT</span>
              <span>01 — 03</span>
            </div>
            <Tabs
              value={selected}
              onValueChange={(value) => {
                setSelected(value);
                setAdvanced(false);
              }}
              className="discovery-tabs"
            >
              <TabsList
                className="discovery-tabs-list"
                aria-label="Choisir une situation à essayer"
              >
                {discoveryScenarios.map((s, i) => (
                  <TabsTrigger key={s.reference} value={String(i)}>
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {discoveryScenarios.map((s, i) => (
                <TabsContent
                  key={s.reference}
                  value={String(i)}
                  className="discovery-preview-content"
                >
                  <div className="discovery-preview" aria-label={'Aperçu fictif : ' + s.label}>
                    <div className="preview-chat-header">
                      <span className="preview-avatar">
                        <Sparkles size={19} />
                      </span>
                      <div>
                        <strong>SAV SC Assistant AI</strong>
                        <small>Votre question. Votre dossier.</small>
                      </div>
                      <span className="preview-sandbox">APERÇU FICTIF</span>
                    </div>
                    <div
                      className="preview-conversation"
                      key={selected + String(advanced)}
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <div className="preview-question">{s.question}</div>
                      <div className="preview-answer">
                        <span className="preview-answer-mark">
                          <Sparkles size={15} />
                        </span>
                        <div>
                          <strong>Voici ce que dit votre dossier.</strong>
                          <p>{advanced ? s.next : s.answer}</p>
                          <small>{s.note}</small>
                        </div>
                      </div>
                    </div>
                    <div className="preview-case">
                      <div className="preview-case-top">
                        <span>
                          <Icon size={18} />
                        </span>
                        <div>
                          <small>{s.category}</small>
                          <strong>{scenario.product}</strong>
                        </div>
                        <ShieldCheck size={18} />
                      </div>
                      <div className="preview-case-line">
                        <span>État du dossier</span>
                        <strong className={advanced && i !== 2 ? 'is-updated' : ''}>
                          <i />
                          {advanced ? s.nextStatus : labels[scenario.status]}
                        </strong>
                      </div>
                      <div className="preview-case-bottom">
                        <code>{s.reference}</code>
                        <span>Maison Atlas · enseigne fictive</span>
                      </div>
                    </div>
                    <button className="preview-advance" onClick={() => setAdvanced(!advanced)}>
                      <RefreshCw size={14} />
                      {advanced
                        ? 'Revenir à l’état initial'
                        : i === 2
                          ? 'Et sans mon accord ?'
                          : 'Et si le dossier avance ?'}
                      <ArrowRight size={15} />
                    </button>
                    <p className="preview-explanation">
                      Exemple illustratif. Votre essai reste isolé de celui des autres visiteurs.
                    </p>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
            <div className="stage-bottom">
              <span>
                <span className="stage-indicator" />À explorer, pas seulement à regarder.
              </span>
              <button disabled={unavailable} onClick={() => onStart(choice.reference)}>
                Essayer ce scénario <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </section>

        <section
          className="discovery-value-strip discovery-container"
          aria-label="Les principes de SAV SC Assistant AI"
        >
          <div>
            <span>01</span>
            <strong>Une information à jour.</strong>
            <small>Le dossier fait foi.</small>
          </div>
          <div>
            <span>02</span>
            <strong>Une prochaine étape lisible.</strong>
            <small>Pas de date inventée.</small>
          </div>
          <div>
            <span>03</span>
            <strong>Une décision qui vous appartient.</strong>
            <small>Les actions se confirment.</small>
          </div>
        </section>

        <section className="discovery-how discovery-container" id="how-atlas">
          <div className="discovery-section-heading">
            <div>
              <span className="discovery-eyebrow">VOYEZ LA DIFFÉRENCE PAR VOUS-MÊME</span>
              <h2>
                Votre premier essai.
                <br />
                Du début à la suite.
              </h2>
            </div>
            <p>Pas besoin de connaître le système. On vous accompagne, un geste à la fois.</p>
          </div>
          <div className="discovery-steps">
            <article>
              <span className="discovery-step-number">
                01 <Wrench size={21} />
              </span>
              <h3>Choisissez une situation.</h3>
              <p>
                Réparation, livraison ou devis : commencez par une question que vous pourriez
                vraiment poser.
              </p>
              <span className="discovery-step-note">8 dossiers à explorer</span>
            </article>
            <article>
              <span className="discovery-step-number">
                02 <LockKeyhole size={21} />
              </span>
              <h3>Ouvrez votre dossier.</h3>
              <p>
                Le code fictif est fourni. La vérification passe par le serveur, jamais par la
                conversation.
              </p>
              <span className="discovery-step-note">Un espace isolé pour chaque visiteur</span>
            </article>
            <article>
              <span className="discovery-step-number">
                03 <RefreshCw size={21} />
              </span>
              <h3>Suivez chaque étape.</h3>
              <p>
                Posez votre question, consultez l’état enregistré et découvrez clairement ce qui
                doit se passer ensuite.
              </p>
              <span className="discovery-step-note">Le dossier reste votre référence</span>
            </article>
          </div>
        </section>

        <section className="discovery-confidence discovery-container">
          <div className="confidence-editorial">
            <span className="discovery-eyebrow">LA CONFIANCE, SANS LES GRANDS MOTS</span>
            <h2>
              Clair sur les réponses.
              <br />
              <span>Clair sur les limites.</span>
            </h2>
            <p>
              Les réponses distinguent les faits enregistrés, les estimations et les prochaines
              actions. Les limites restent visibles.
            </p>
            <button onClick={onContact}>
              Poser une question <Mail size={17} />
            </button>
          </div>
          <Accordion type="single" collapsible defaultValue="demo" className="discovery-faq">
            <AccordionItem value="demo">
              <AccordionTrigger>Est-ce un vrai dossier client ?</AccordionTrigger>
              <AccordionContent>
                Non. Maison Atlas, les produits et les clients sont fictifs. Votre espace possède
                cependant sa propre base de simulation : vos actions et vos échanges y sont
                enregistrés, sans modifier ceux des autres visiteurs. N’entrez aucune donnée
                personnelle réelle.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="privacy">
              <AccordionTrigger>Puis-je utiliser mes vraies informations ?</AccordionTrigger>
              <AccordionContent>
                Non. Cette version présente un parcours avec des données fictives. N’indiquez ni
                identité réelle, ni code confidentiel, ni donnée bancaire dans la conversation.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="control">
              <AccordionTrigger>Que se passe-t-il si j’accepte un devis ?</AccordionTrigger>
              <AccordionContent>
                Une confirmation explicite est demandée. Seul le dossier fictif évolue. Aucun
                paiement, email, SMS ni ordre de réparation réel n’est envoyé.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="system">
              <AccordionTrigger>Comment les informations restent-elles à jour ?</AccordionTrigger>
              <AccordionContent>
                L’assistant relit l’état enregistré avant de répondre. Dans cette démonstration,
                chaque visiteur dispose d’un espace isolé et temporaire.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <section className="discovery-final discovery-container">
          <div>
            <span className="discovery-eyebrow">À VOTRE TOUR</span>
            <h2>
              Une question en tête ?<br />
              Commencez par un dossier.
            </h2>
          </div>
          <div className="discovery-final-actions">
            <button className="discovery-contact-cta" onClick={onContact}>
              Nous contacter <Mail size={18} />
            </button>
            <button
              className="discovery-primary"
              disabled={unavailable}
              onClick={() => onStart(choice.reference)}
            >
              Essayer l’assistant <ArrowRight size={19} />
            </button>
          </div>
        </section>
      </main>
      <footer className="discovery-footer discovery-container">
        <span>SAV SC Assistant AI</span>
        <span>Démonstration · Données fictives</span>
        <div className="discovery-footer-actions">
          <button onClick={onContact}>Nous contacter</button>
        </div>
      </footer>
    </div>
  );
}
