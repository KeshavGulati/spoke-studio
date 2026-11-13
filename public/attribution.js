export function maskAttribution(frame, { visible = true, dirty = false } = {}) {
  if (!visible || !frame) return { hidden: true, text: '', title: '' };
  const owner = frame.mask_attribution;
  if (!owner) {
    return { hidden: false, text: dirty ? 'Unsaved new mask' : (frame.saved ? 'Saved mask · contributor unknown' : 'No saved mask'),
      title: 'No contributor information is available for this mask' };
  }
  const name = owner.username || 'Unknown contributor';
  let timestamp = '';
  const date = new Date(owner.timestamp);
  if (owner.timestamp && !Number.isNaN(date.getTime())) timestamp = ' · Saved ' + date.toLocaleString();
  return {
    hidden: false,
    text: dirty ? `Unsaved edits · Last saved by ${name}` : `Mask saved by ${name}`,
    title: `User ID: ${owner.user_id || 'unknown'}${timestamp}`,
  };
}
