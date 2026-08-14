// Native-federation config for the "wiki" remote.
//
// The shareAll args + RxJS skip list live in ./federation-base.js (copied
// BYTE-IDENTICAL from the hugmesh.net host, like every other HugMesh
// remote) so this remote's federation surface can't drift from the host. The
// remote name ("wiki") and the exposed module key ("./Wiki") are the contract
// the host's loadRemoteModule() depends on AND the contract the federation-api
// wiki module row (#16) already points at:
//   remote_entry_url = http://hugmesh-wiki-ui:8080/remoteEntry.json
//   metadata.mountAt = /wiki   metadata.requiresRole = wiki   visibility = internal
// So the remoteEntry.json emitted by the production build MUST expose ./Wiki,
// and the container MUST serve it on :8080 (see Dockerfile + nginx.conf).
const { hugmeshRemote } = require('./federation-base');

module.exports = hugmeshRemote({
  name: 'wiki',
  exposes: {
    './Wiki': './src/app/wiki.routes.ts',
  },
});
