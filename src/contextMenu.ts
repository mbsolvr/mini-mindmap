export function fitContextMenu(menu: HTMLDivElement | null) {
  if (!menu) return;
  const margin = 8;
  menu.style.maxHeight = `${Math.max(0, window.innerHeight - margin * 2)}px`;
  menu.style.maxWidth = `${Math.max(0, window.innerWidth - margin * 2)}px`;
  menu.style.overflow = "auto";
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(margin, Math.min(parseFloat(menu.style.left), window.innerWidth - bounds.width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(parseFloat(menu.style.top), window.innerHeight - bounds.height - margin))}px`;
}
