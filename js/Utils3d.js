import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

class Utils3dLoader {
    constructor() {
        this.cache = { };
        this.loader = new MTLLoader();
    }
    load(url, onLoad) {
        if(this.cache[url]){
            return onLoad(this.cache[url]);
        }
        this.loader.load(
            `${url}.mtl`, (mtl)=>{
                const objloader = new OBJLoader();

                mtl.preload();
                objloader.setMaterials(mtl);
                objloader.load(
                    `${url}.obj`, 
                    (obj)=> onLoad(
                        this.cache[url] = obj
                    ),
                    this.onProgress,
                    this.onError
                );
            },
            this.onProgress, 
            this.onError
        );
    }
    onLoad(xhr) {
        console.log(`${xhr.loaded / xhr.total * 100}% loaded`);
    }
    onError(error) {
        console.error(`Failed to load : ${error}`);
    }
}

export { Utils3dLoader };
