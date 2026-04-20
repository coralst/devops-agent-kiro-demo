import { getItems, checkout, resetFault } from './api';
import type { Product } from './api';

const productGrid = document.getElementById('product-grid')!;
const loadingEl = document.getElementById('loading')!;
const errorBanner = document.getElementById('error-banner')!;
const notification = document.getElementById('notification')!;
const resetBtn = document.getElementById('reset-btn')!;

/** Format cents as a dollar string. */
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Show a temporary notification banner. */
function showNotification(
  message: string,
  type: 'success' | 'error' | 'info',
): void {
  notification.textContent = message;
  notification.className = `notification ${type}`;
  setTimeout(() => {
    notification.className = 'notification hidden';
  }, 5000);
}

/** Build the HTML for a single product card. */
function createProductCard(product: Product): HTMLElement {
  const card = document.createElement('article');
  card.className = product.isTrigger
    ? 'product-card trigger-item'
    : 'product-card';

  const badge = product.isTrigger
    ? '<span class="trigger-badge">⚠ Fault Trigger</span>'
    : '';

  card.innerHTML = `
    ${badge}
    <h2 class="product-name">${product.name}</h2>
    <span class="product-category">${product.category}</span>
    <p class="product-description">${product.description}</p>
    <p class="product-price">${formatPrice(product.price)}</p>
    <button class="buy-btn" type="button" data-item-id="${product.id}">
      Buy
    </button>
  `;

  const buyBtn = card.querySelector('.buy-btn') as HTMLButtonElement;
  buyBtn.addEventListener('click', () => handleBuy(product.id, buyBtn));

  return card;
}

/** Handle a buy button click. */
async function handleBuy(
  itemId: string,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  button.textContent = 'Processing…';
  try {
    const result = await checkout(itemId, 1);
    const faultNote = result.faultInjected ? ' (fault injected!)' : '';
    showNotification(
      `Order ${result.orderId} — ${result.status}${faultNote}`,
      'success',
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Checkout failed';
    showNotification(message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Buy';
  }
}

/** Handle the reset button click. */
async function handleReset(): Promise<void> {
  resetBtn.setAttribute('disabled', 'true');
  try {
    const result = await resetFault();
    showNotification(
      `${result.message} (disk usage: ${result.diskUsagePercent}%)`,
      'info',
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Reset failed';
    showNotification(message, 'error');
  } finally {
    resetBtn.removeAttribute('disabled');
  }
}

/** Load products and render the grid. */
async function init(): Promise<void> {
  try {
    const products = await getItems();
    loadingEl.className = 'loading hidden';
    products.forEach((product) => {
      productGrid.appendChild(createProductCard(product));
    });
  } catch {
    loadingEl.className = 'loading hidden';
    errorBanner.className = 'error-banner';
  }
}

resetBtn.addEventListener('click', handleReset);
init();
