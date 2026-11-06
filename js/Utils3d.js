import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

class Utils3dLoader {
    constructor() {
        this.cache = { };
        this.loader = new MTLLoader();
    }
    load(url, onLoad, onError = this.onError) {
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
                    onError
                );
            },
            this.onProgress,
            onError
        );
    }
    // Même chose, en promesse (rejetée si le .mtl ou le .obj manque : un nouvel essai les retélécharge)
    loadAsync(url) {
        return new Promise((resolve, reject) => this.load(url, resolve, () => reject(new Error(`${url}.obj introuvable`))));
    }
    onLoad(xhr) {
        console.log(`${xhr.loaded / xhr.total * 100}% loaded`);
    }
    onError(error) {
        console.error(`Failed to load : ${error}`);
    }
}

export { Utils3dLoader };
