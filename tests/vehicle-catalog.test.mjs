import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VEHICLE_MODELS,resolveVehicleModel,vehicleModel} from '../src/vehicle-catalog.mjs';

test('visual models cover the seven selected variants with separate assets and credits',()=>{
  assert.equal(VEHICLE_MODELS.length,7);
  assert.equal(new Set(VEHICLE_MODELS.map(model=>model.asset)).size,7);
  assert.deepEqual([...new Set(VEHICLE_MODELS.map(model=>model.family))].sort(),['Model 3','Model S','Model X','Model Y']);
  for(const model of VEHICLE_MODELS){assert.ok(model.artist);assert.match(model.license,/CC BY/);assert.match(model.source,/^https:\/\//);}
  assert.equal(vehicleModel('modely-2025').asset,'vehicle.glb');
});

test('manual visual selection is independent of the source vehicle and invalid stored values cannot choose a URL',()=>{
  const car={car_id:12,name:'Example',car_details:{model:'Model Y',model_year:2025}};
  const before=JSON.stringify(car);
  assert.equal(resolveVehicleModel(car,'model3-2018'),'model3-2018');
  assert.equal(resolveVehicleModel(car,'https://invalid.example/model.glb'),'modely-2025');
  assert.equal(JSON.stringify(car),before);
});

test('automatic matching uses explicit family/year metadata while preserving the existing Y fallback',()=>{
  const choose=(model,year)=>resolveVehicleModel({car_details:{model,model_year:year}},'auto');
  assert.equal(choose('Tesla Model 3',2018),'model3-2018');
  assert.equal(choose('Model 3',2024),'model3-2024');
  assert.equal(choose('Model S',2013),'models-2013');
  assert.equal(choose('Model S',2021),'models-2021');
  assert.equal(choose('Model X',2020),'modelx-2020');
  assert.equal(choose('Model Y',2021),'modely-2021');
  assert.equal(choose('Model Y',undefined),'modely-2025');
  assert.equal(choose(undefined,2018),'modely-2025');
});
