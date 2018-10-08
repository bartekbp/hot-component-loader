const loaderUtils = require('loader-utils');
const path = require('path');
const fs = require('fs');
const jsesc = require('jsesc');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;

module.exports = function(content, map, meta) {
  const filename = path.basename(this.resource);
  const options = loaderUtils.getOptions(this);
  const requireAngular = !!options.requireAngular || false;
  const moduleName = options.appModule;
  const appElement = options.appElement || 'body';
  const componentFilenameSuffix = options.componentFilenameSuffix;
  const recognizedExtensions = this._compilation.options.resolve.extensions;

  const ast = babylon.parse(content, {
    sourceType: 'module',
    plugins: [
      'dynamicImport',
      'asyncGenerators',
      'objectRestSpread',
      'optionalCatchBinding',
      'exportDefaultFrom',
      'exportNamespaceFrom',
      'optionalCatchBinding',
      'throwExpressions'
    ]
  });

  const dependencies = [];

  traverse(ast, {
    enter(path) {
      if(path.node.type === 'ImportDeclaration') {
        const node = path.node;
        const importTarget = node.source.value;
        dependencies.push(importTarget);

        return;
      }

      if(path.node.type === 'CallExpression') {
        const node = path.node;
        const { arguments, callee } = node;
        if(callee.type !== 'Identifier' || callee.name !== 'require') {
          return;
        }

        const firstArg = arguments[0];
        if(firstArg.type !== 'StringLiteral') {
          return;
        }

        const requiredName = firstArg.value;
        dependencies.push(requiredName);
      }
    }
  });

  const fileImportDir = path.dirname(this.resource);
  const importedAbsolutePaths = dependencies
      .map(filepath => path.resolve(fileImportDir, filepath))
      .map(filepath => path.relative(this.rootContext, filepath))
      .map(filepath => "./" + filepath.replace(/\\/g, '/'))
      .map(baseFilepath => {
        const ext = ['', ...recognizedExtensions].find(ext => fs.existsSync(baseFilepath + ext));
        if(ext !== undefined) {
          return baseFilepath + ext;
        }

        return null;
      })
      .filter(filepath => filepath);

  if (filename.endsWith(componentFilenameSuffix)) {
    return `${content}
    {
    
      const __hotComponentLoader__module = arguments[0];
      const handleReloading = () => {
        if(!__hotComponentLoader__module.hot) {
          return;
        }
        
        const angularRef = ${requireAngular ? "require('angular');\\n" : "window.angular"};      
        const appModule = angular.module('${moduleName}');
        const ngElement = angularRef.element('${appElement}');
        
        const requestsQueue = appModule._invokeQueue;
        const componentAllRequests = requestsQueue.filter(([provider, callbackType, [name, args]])  => 
          provider === '$compileProvider' && 
          callbackType === 'component');
          
        const componentRequest = componentAllRequests[componentAllRequests.length - 1];
        const componentName = componentRequest[2][0];
        const requestParams = componentRequest[2];
        
        __hotComponentLoader__module.hot.accept(err => console.warn(err));
        __hotComponentLoader__module.hot.decline(${"[" + importedAbsolutePaths.map(dep => "'" + jsesc(dep) + "'") + "]"});
        
        if(!window.hotComponentLoaderComponentCache) {
          window.hotComponentLoaderComponentCache = {};
        }
        
        window.hotComponentLoaderComponentCache[componentName] = requestParams[1];
        
        appModule
          .decorator(componentName + "Directive", ["$delegate", ($delegate) => {
            const originalDirective = $delegate[0];
            const handler = {
              get: (target, name, receiver) => {
                const cacheValue = window.hotComponentLoaderComponentCache[componentName];
                const dirtyKeys = target.__hotComponentLoaderDirtyKeys;
                if((!dirtyKeys  || !target.__hotComponentLoaderDirtyKeys.has(name)) && cacheValue.hasOwnProperty(name)) {
                  return Reflect.get(cacheValue, name, receiver);
                }
  
                // return target[name];
                return Reflect.get(target, name, receiver);
              },
              set: (target, name, value, receiver) => {              
                const modifiedKeys = target.__dirtyHotComponentLoaderKeys;
                if(!target.__hotComponentLoaderDirtyKeys) {
                  target.__hotComponentLoaderDirtyKeys = new Set();
                } 
                
                target.__hotComponentLoaderDirtyKeys.add(name);                
                Reflect.set(target, name, value, receiver);
                return true;
              }
            };
            const proxy = new Proxy(originalDirective, handler);
            return [proxy];
          }]);
          
        const injector = ngElement.data() ? ngElement.data().$injector : null;
        if(!injector) {
          return;
        }
        
        injector.get('$route').reload();
      };
    
      handleReloading();
    }`;
  }

  return content;
};


