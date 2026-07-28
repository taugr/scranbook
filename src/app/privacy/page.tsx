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
        database. By default, meal entries, processed photos, preferences, and
        any saved model credentials are kept in your browser storage on this
        device. IndexedDB remains the working copy even if you optionally enable
        Google Drive backup.
      </p>
      <h2>When a photo leaves the device</h2>
      <p>
        Scranbook sends a photo only when you choose{' '}
        <strong>Analyse photo</strong> or{' '}
        <strong>Scan label with configured model</strong>. It goes directly from
        your browser to the model endpoint you configured. A remote endpoint
        receives that photo; a model running on your own computer may keep the
        request local.
      </p>
      <h2>What Cloudflare receives</h2>
      <p>
        Cloudflare serves the application files. Scranbook does not send diary
        records or photos to a Scranbook API. As with most websites,
        infrastructure may process ordinary request metadata such as IP address,
        requested URL, and browser headers when serving the app.
      </p>
      <h2>Optional Google Drive backup</h2>
      <p>
        If you choose <strong>Connect Google Drive</strong>, Scranbook asks only
        for permission to manage files it creates or that you explicitly share
        with it. The browser copies accepted diary entries and processed photos
        directly to a visible Scranbook folder in your Google Drive. Cloudflare
        does not receive those backup requests.
      </p>
      <p>
        Model credentials, custom request headers, Google access tokens,
        preferences, and unfinished drafts are not included. The Google access
        token is held in memory for the current page only, so you may need to
        reconnect after reopening Scranbook. Automatic backup runs only while
        the app is open, online, and authorized.
      </p>
      <p>
        Disconnecting stops future backups but does not delete either your local
        diary or existing files in Drive. You can also revoke permission from
        your Google Account. Restoring from Drive validates the complete backup
        and asks before replacing the diary stored in this browser.
      </p>
      <h2>Control and deletion</h2>
      <p>
        Settings lets you share or download a versioned archive, delete the
        complete local diary, disconnect Google Drive, and separately clear
        model credentials. Removing site data in your browser also removes
        Scranbook data from that browser profile, but does not remove a backup
        already stored in Drive.
      </p>
      <h2>Local nutrition estimates</h2>
      <p>
        Nutrition calculations do not call a nutrition service. Scranbook
        matches your edited ingredient names and gram estimates against a
        bundled copy of{' '}
        <a href="https://fdc.nal.usda.gov/download-datasets/">
          USDA FoodData Central
        </a>{' '}
        and the UK{' '}
        <a href="https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid">
          Composition of Foods Integrated Dataset
        </a>
        . The matching and arithmetic happen in this browser and remain
        available offline.
      </p>
      <h2>Nutrition labels</h2>
      <p>
        A configured model can transcribe a nutrition panel after you explicitly
        start a scan. You review the printed values and enter how much you
        consumed. Scranbook performs the scaling in this browser, does not send
        the label to a nutrition service, and also supports fully manual label
        entry offline.
      </p>
      <p>
        Contains public sector information licensed under the{' '}
        <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">
          Open Government Licence v3.0
        </a>
        .
      </p>
      <h2>Important limits</h2>
      <p>
        Ingredient recognition, portion weights, database matches, label
        transcription, and nutritional totals may be incomplete or incorrect.
        They are not allergy, medical, or food-safety advice. Locally stored
        credentials can be read by code running under the Scranbook origin;
        session-only credential storage is available for reduced persistence.
      </p>
    </main>
  );
}
