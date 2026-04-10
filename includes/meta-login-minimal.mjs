// Minimal test ESM module
import metaMessenger from 'meta-messenger.js';

export default function login(loginData, callback) {
    console.log('[Meta-Login] Initialize');
    callback(null, {});
}
