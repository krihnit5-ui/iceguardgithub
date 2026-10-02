export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  return res.status(200).json({
    engine: 'IceGuardAI',
    version: '2.0',
    models: [
      {
        name: 'kNN anomaly detector',
        type: 'unsupervised ML',
        purpose: 'flag unusual observed iceberg/environment feature combinations'
      },
      {
        name: 'degree-2 polynomial trajectory regression (plug-in; physics baseline is used until trained)',
        type: 'supervised ML',
        purpose: 'estimate iceberg drift speed from historical wind/drift training samples',
        status: 'requires validated historical training data'
      }
    ],
    safeguards: [
      'missing wind is never imputed as zero',
      'untrained trajectory model fails closed',
      'modelled positions are labelled MODELLED_NOT_OBSERVED',
      'route output is DECISION_SUPPORT_ONLY'
    ]
  });
}
