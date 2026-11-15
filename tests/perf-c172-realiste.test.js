// Mêmes tests que perf-c172.test.js, sur le modèle de vol réaliste (js/RigidBodyModel.js)
process.env.TEST_MODEL = 'realiste';
await import('./perf-c172.test.js');
