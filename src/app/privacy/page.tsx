import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link href="/" className="text-link">
        ← Back to Scranbook
      </Link>
      <p className="eyebrow">Plain-language privacy</p>
      <h1>Your diary belongs on your device.</h1>
      <p>
        Scranbook has no accounts, analytics, advertising, or server-side diary
        database. Meal entries, processed photos, preferences, and any saved
        model credentials are kept in your browser storage on this device.
      </p>
      <h2>When a photo leaves the device</h2>
      <p>
        Scranbook sends a photo only when you choose{' '}
        <strong>Analyse photo</strong>. It goes directly from your browser to
        the model endpoint you configured. A remote endpoint receives that
        photo; a model running on your own computer may keep the request local.
      </p>
      <h2>What Cloudflare receives</h2>
      <p>
        Cloudflare serves the application files. Scranbook does not send diary
        records or photos to a Scranbook API. As with most websites,
        infrastructure may process ordinary request metadata such as IP address,
        requested URL, and browser headers when serving the app.
      </p>
      <h2>Control and deletion</h2>
      <p>
        Settings lets you export a versioned archive, delete the complete diary,
        and separately clear model credentials. Removing site data in your
        browser also removes Scranbook data from that browser profile.
      </p>
      <h2>Important limits</h2>
      <p>
        Model output is an editable estimate, not nutritional, allergy, medical,
        or food-safety advice. Locally stored credentials can be read by code
        running under the Scranbook origin; session-only credential storage is
        available for reduced persistence.
      </p>
    </main>
  );
}
