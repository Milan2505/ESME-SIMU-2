// Mêmes tests que flight-model.test.js, sur le modèle de vol réaliste (js/RigidBodyModel.js)
process.env.TEST_MODEL = 'realiste';
await import('./flight-model.test.js');
