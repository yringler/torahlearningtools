import { applyUpdate, useUpdateReady } from "../swUpdate";

/** One line at the bottom of the screen when a newer version of the app has been downloaded. */
export function UpdateBar() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="update-bar" role="status">
      <span>A new version is ready.</span>
      <button className="btn primary" onClick={applyUpdate}>Reload</button>
    </div>
  );
}
