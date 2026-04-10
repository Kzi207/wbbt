/**
 * CommonJS wrapper cho meta-login.mjs
 * Allows require('./meta-login') to work with ESM exports
 */

(async () => {
    // Dynamically import ESM module
    const loginModule = await import('./meta-login.mjs');
    const login = loginModule.default;
    
    // Export as CommonJS
    module.exports = login;
})();
