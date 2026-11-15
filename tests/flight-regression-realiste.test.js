// Mêmes tests que flight-regression.test.js, sur le modèle de vol réaliste (js/RigidBodyModel.js)
process.env.TEST_MODEL = 'realiste';
await import('./flight-regression.test.js');
