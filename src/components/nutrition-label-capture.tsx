'use client';

import {
  ImagePlus,
  Laptop,
  RotateCw,
  ScanLine,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { endpointLocation } from '@/lib/provider';
import type { ModelSettings } from '@/lib/schema';

export function NutritionLabelCapture({
  photoUrl,
  settings,
  busy,
  stale,
  onFile,
  onRotate,
  onRemovePhoto,
  onScan,
  onCancel,
  onManual,
  onKeepValues,
  onPrivacyChange,
  onOpenSettings,
}: {
  photoUrl: string | null;
  settings: ModelSettings;
  busy: string | null;
  stale: boolean;
  onFile: (file?: File) => void;
  onRotate: () => void;
  onRemovePhoto: () => void;
  onScan: () => void;
  onCancel: () => void;
  onManual: () => void;
  onKeepValues: () => void;
  onPrivacyChange: (checked: boolean) => void;
  onOpenSettings: () => void;
}) {
  const location = endpointLocation(settings.baseUrl);
  return (
    <div className="label-capture-stack">
      <div className="label-capture-guidance">
        <ScanLine />
        <div>
          <strong>Fill the frame with the nutrition panel</strong>
          <p>
            Keep it flat and upright, avoid glare, and include the column
            headings and serving-size text.
          </p>
        </div>
      </div>
      {photoUrl ? (
        <div className="photo-preview label-photo-preview">
          <img src={photoUrl} alt="Nutrition label ready to review" />
          <div className="photo-tools">
            <button onClick={onRotate}>
              <RotateCw /> Rotate
            </button>
            <label className="file-picker">
              <ImagePlus /> Replace
              <input
                className="visually-hidden"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Replace nutrition label photo"
                onChange={(event) => onFile(event.target.files?.[0])}
              />
            </label>
            <button onClick={onRemovePhoto}>
              <Trash2 /> Remove
            </button>
          </div>
        </div>
      ) : (
        <label className="camera-drop file-picker label-camera-drop">
          <span className="camera-orbit">
            <ScanLine />
          </span>
          <strong>Photograph the nutrition panel</strong>
          <span>Use the camera or choose a clear label photo.</span>
          <span className="button button--primary">
            <ImagePlus /> Choose label photo
          </span>
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Choose nutrition label photo"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
      )}
      {stale && (
        <div className="nutrition-warning label-stale-warning">
          <strong>The label photo changed.</strong>
          <span>
            Scan it again, or confirm that the reviewed values still apply.
          </span>
          <button className="text-button" onClick={onKeepValues}>
            Keep reviewed values
          </button>
        </div>
      )}
      {photoUrl && (
        <div className="analysis-card label-analysis-card">
          <div>
            <span className="sparkle-badge">
              <Sparkles />
            </span>
            <div>
              <strong>Transcribe the printed panel</strong>
              <p>
                {settings.model} via {settings.baseUrl}
              </p>
            </div>
          </div>
          <p className={`label-endpoint label-endpoint--${location}`}>
            <Laptop />
            {location === 'local'
              ? 'This endpoint appears local or on your private network.'
              : location === 'remote'
                ? 'This photo will leave the device for a remote endpoint.'
                : 'Check the endpoint address before scanning.'}
          </p>
          <label className="privacy-check">
            <input
              type="checkbox"
              checked={settings.privacyAcknowledged}
              onChange={(event) => onPrivacyChange(event.target.checked)}
            />
            <span>
              I understand this label photo goes directly to my configured model
              endpoint.
            </span>
          </label>
          <div className="analysis-actions">
            <button
              id="scan-nutrition-label"
              className="button button--aubergine"
              onClick={onScan}
              disabled={Boolean(busy)}
            >
              <ScanLine /> Scan label with configured model
            </button>
            {busy && (
              <button className="button button--quiet" onClick={onCancel}>
                Cancel
              </button>
            )}
            <button className="text-button" onClick={onOpenSettings}>
              Model settings
            </button>
          </div>
        </div>
      )}
      <button
        className="button button--quiet label-manual-button"
        onClick={onManual}
      >
        Enter label manually
      </button>
    </div>
  );
}
