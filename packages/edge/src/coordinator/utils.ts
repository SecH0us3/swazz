export function isVersionOutdated(runnerVer: string, coordVer: string): boolean {
  if (typeof runnerVer !== 'string') {
    throw new TypeError('runnerVer must be a string');
  }
  if (typeof coordVer !== 'string') {
    throw new TypeError('coordVer must be a string');
  }
  if (runnerVer === 'dev' || coordVer === 'dev') return false;
  
  const cleanRunner = runnerVer.replace(/^v\.?/, '');
  const cleanCoord = coordVer.replace(/^v\.?/, '');
  
  const [runnerRelease, runnerPre] = cleanRunner.split('-');
  const [coordRelease, coordPre] = cleanCoord.split('-');
  
  const runnerParts = runnerRelease.split('.').map(Number);
  const coordParts = coordRelease.split('.').map(Number);
  
  for (let i = 0; i < Math.max(runnerParts.length, coordParts.length); i++) {
    const r = runnerParts[i] || 0;
    const c = coordParts[i] || 0;
    if (isNaN(r) || isNaN(c)) {
      if (runnerRelease < coordRelease) return true;
      if (runnerRelease > coordRelease) return false;
      break;
    }
    if (r < c) return true;
    if (r > c) return false;
  }
  
  if (runnerPre && !coordPre) return true;
  if (!runnerPre && coordPre) return false;
  if (runnerPre && coordPre) {
    return runnerPre < coordPre;
  }
  
  return false;
}
