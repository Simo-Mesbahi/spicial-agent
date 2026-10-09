'use client';

import { useState } from 'react';
import { CONTACT_RECIPIENT } from '@/lib/atlas/contact';

export function CopyCommercialEmail() {
  const [message, setMessage] = useState('');

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(CONTACT_RECIPIENT);
      setMessage('Adresse copiée. Collez-la dans votre messagerie.');
    } catch {
      setMessage('Copie indisponible. Sélectionnez l’adresse ci-dessous pour la copier.');
    }
  }

  return (
    <div className="showcase-email-fallback">
      <label htmlFor="commercial-email">Votre messagerie ne s’ouvre pas ? Copiez l’adresse :</label>
      <div>
        <input
          id="commercial-email"
          type="text"
          readOnly
          value={CONTACT_RECIPIENT}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" onClick={() => void copyAddress()}>
          Copier
        </button>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
