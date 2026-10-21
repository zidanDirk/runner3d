import {describe,expect,it} from 'vitest';
import {BoxGeometry,Group,InstancedMesh,Matrix4,MeshBasicMaterial} from 'three';
import {CityInstanceWriter,releaseDetachedInstance} from '../../src/scene/CityInstanceWriter';
import type {CityInstance} from '../../src/scene/CityInstanceWriter';

const items:readonly CityInstance[]=[{placement:{id:'writer-probe',chunkId:1,assetId:'city-building-01',position:[14,0,-10],scale:[1,1,1],rotationY:0},offset:30}];
describe('city instance host lifecycle',()=>{
 it('initializes a replaced host even with the same placement references, never renders spare constructor identities',()=>{
  const geometry=new BoxGeometry(6,10,6),material=new MeshBasicMaterial();const a=new InstancedMesh(geometry,material,54),b=new InstancedMesh(geometry,material,54);const writer=new CityInstanceWriter();
  writer.sync(a,items);const version=a.instanceMatrix.version;writer.sync(a,items);expect(a.instanceMatrix.version).toBe(version);
  expect(b.count).toBe(54);writer.sync(b,items);expect(b.count).toBe(1);
  const matrix=new Matrix4();b.getMatrixAt(0,matrix);expect(matrix.elements[12]).toBe(14);expect(matrix.elements[14]).toBe(-40);
  b.count=54;writer.sync(b,items);expect(b.count).toBe(1);expect(b.boundingBox?.min.x).toBe(11);
  writer.sync(b,[]);expect(b.count).toBe(0);expect(b.boundingBox?.isEmpty()).toBe(true);
  a.dispose();b.dispose();geometry.dispose();material.dispose();
 });
 it('keeps attached buffers alive through effect replay and releases only the detached instance',async()=>{
  const geometry=new BoxGeometry(),material=new MeshBasicMaterial(),mesh=new InstancedMesh(geometry,material,2);const group=new Group();let disposed=0,shared=0;
  mesh.addEventListener('dispose',()=>disposed++);geometry.addEventListener('dispose',()=>shared++);material.addEventListener('dispose',()=>shared++);
  group.add(mesh);releaseDetachedInstance(mesh);await Promise.resolve();expect(disposed).toBe(0);
  group.remove(mesh);releaseDetachedInstance(mesh);await Promise.resolve();expect(disposed).toBe(1);expect(shared).toBe(0);geometry.dispose();material.dispose();
 });
});
