// Display models are independent of the selected TeslaMate vehicle and its data.
export const VEHICLE_MODELS = Object.freeze([
  {id:'modely-2025', label:'Model Y · 新款', family:'Model Y', year:2025, asset:'vehicle.glb', artist:'BloxBloger', license:'CC BY-NC 4.0', source:'https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74'},
  {id:'modely-2021', label:'Model Y · 2021', family:'Model Y', year:2021, asset:'vehicles/modely-2021/model.glb', artist:'tonielpro520', license:'CC BY 4.0', source:'https://sketchfab.com/3d-models/2021-tesla-model-y-59e2ead369984b1a85c800ff6cf6789d'},
  {id:'model3-2018', label:'Model 3 · 2018', family:'Model 3', year:2018, asset:'vehicles/model3-2018/model.glb', artist:'Ameer Studio', license:'CC BY 4.0', source:'https://sketchfab.com/3d-models/tesla-2018-model-3-5ef9b845aaf44203b6d04e2c677e444f'},
  {id:'model3-2024', label:'Model 3 · 2024 焕新版', family:'Model 3', year:2024, asset:'vehicles/model3-2024/model.glb', artist:'tonielpro520', license:'CC BY 4.0', source:'https://sketchfab.com/3d-models/2024-tesla-model-3-interior-61ddcbdbd3854c239e0c95bf60b00022'},
  {id:'models-2013', label:'Model S · 早期款', family:'Model S', year:2013, asset:'vehicles/models-2013/model.glb', artist:'oriolfrancin99 / iSteven', license:'CC BY 4.0 + CC BY-NC 4.0', source:'https://sketchfab.com/3d-models/tesla-model-s-79cc7a8accfb421fa5981d4186fbfd75'},
  {id:'models-2021', label:'Model S Plaid · 2021 改款', family:'Model S', year:2021, asset:'vehicles/models-2021/model.glb', artist:'3D Hawk', license:'CC BY 4.0', source:'https://github.com/jz237/jez237-site'},
  {id:'modelx-2020', label:'Model X · 老款', family:'Model X', year:2020, asset:'vehicles/modelx-2020/model.glb', artist:'Abdul.Hannan', license:'CC BY 4.0', source:'https://sketchfab.com/3d-models/tesla-model-x-6a5469a1b776431cb1e1e17a72a2c4f5'},
]);

export function vehicleModel(id) {
  return VEHICLE_MODELS.find(model => model.id === id) ?? VEHICLE_MODELS[0];
}

export function resolveVehicleModel(car, selection) {
  if (typeof selection === 'string' && VEHICLE_MODELS.some(model => model.id === selection)) return selection;
  const details = car?.car_details ?? {};
  const family = String(details.model ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^tesla/, '');
  const year = Number(details.model_year ?? details.year);
  const knownYear = Number.isInteger(year) && year >= 2012 && year <= 2100;
  if (family === 'model3' || family === '3') return knownYear && year < 2024 ? 'model3-2018' : 'model3-2024';
  if (family === 'models' || family === 's') return knownYear && year < 2021 ? 'models-2013' : 'models-2021';
  if (family === 'modelx' || family === 'x') return 'modelx-2020';
  if (family === 'modely' || family === 'y') return knownYear && year < 2025 ? 'modely-2021' : 'modely-2025';
  return 'modely-2025';
}
