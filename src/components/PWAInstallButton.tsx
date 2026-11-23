import React, { useState } from 'react';
import { Download, Share, PlusSquare, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        title="Install AMAL as a standalone app"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0F4C3A] bg-[#0F4C3A]/10 border border-[#0F4C3A]/25 rounded-lg hover:bg-[#0F4C3A]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Install App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          title="Install AMAL on your iPhone or iPad"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0F4C3A] bg-[#0F4C3A]/10 border border-[#0F4C3A]/25 rounded-lg hover:bg-[#0F4C3A]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Install App</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-neutral-200">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id="ios-install-title"
                    className="text-base font-bold text-neutral-950 font-display"
                  >
                    Install AMAL on iPhone / iPad
                  </h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    Launch AMAL directly from your home screen in standalone mode.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="p-1 text-neutral-400 hover:text-neutral-700 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ol className="mt-4 space-y-3 text-sm text-neutral-700">
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#0F4C3A]/10 text-[#0F4C3A] text-xs font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span className="flex items-center gap-1.5">
                    Tap the <Share className="w-4 h-4 text-[#0F4C3A] inline" />{' '}
                    <strong>Share</strong> button in Safari.
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#0F4C3A]/10 text-[#0F4C3A] text-xs font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span className="flex items-center gap-1.5">
                    Scroll down and tap{' '}
                    <PlusSquare className="w-4 h-4 text-[#0F4C3A] inline" />{' '}
                    <strong>Add to Home Screen</strong>.
                  </span>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#0F4C3A] py-2.5 text-xs font-semibold text-white hover:bg-[#0B3B2D] transition-colors cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg border border-amber-500"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Cached storefront assets active.</span>
    </div>
  );
};
