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
    const r = runnerParts[i];
    const c = coordParts[i];
    if (r === undefined && c === undefined) break;
    const rNum = r === undefined ? 0 : r;
    const cNum = c === undefined ? 0 : c;
    if (isNaN(rNum) || isNaN(cNum)) {
      if (runnerRelease < coordRelease) return true;
      if (runnerRelease > coordRelease) return false;
      break;
    }
    if (rNum < cNum) return true;
    if (rNum > cNum) return false;
  }
  
  if (runnerPre && !coordPre) return true;
  if (!runnerPre && coordPre) return false;
  if (runnerPre && coordPre) {
    return runnerPre < coordPre;
  }
  
  return false;
}

export function getPublicKeyFromTags(tags: string[]): string | undefined {
  return tags.find(t =>
    t !== 'runner-pending' &&
    t !== 'runner' &&
    !t.startsWith('name:') &&
    !t.startsWith('version:') &&
    !t.startsWith('user_id:')
  );
}

export function getRunIdFromTags(tags: string[]): string | undefined {
  return tags.find(t =>
    t !== 'client' &&
    t !== 'runner' &&
    t !== 'runner-pending' &&
    !t.startsWith('name:') &&
    !t.startsWith('version:') &&
    !t.startsWith('user_id:')
  );
}
