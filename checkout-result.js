(async () => {
  const title = document.querySelector('#confirm-title');
  const message = document.querySelector('#confirm-message');
  const details = document.querySelector('#order-details');
  const orderId = document.querySelector('#order-id');
  const paymentStatus = document.querySelector('#payment-status');
  const orderTotal = document.querySelector('#order-total');

  document.querySelector('#year').textContent = new Date().getFullYear();

  const sessionId = new URLSearchParams(location.search).get('session_id');

  if (!sessionId) {
    title.textContent = 'Missing checkout reference';
    message.textContent = 'We could not find the checkout session associated with this order.';
    return;
  }

  const formatMoney = (cents, currency = 'USD') =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(cents / 100);

  const showPaid = (data) => {
    title.textContent = 'Payment successful';
    message.textContent =
      'Thank you. Your order has been received and is being processed. A confirmation email is on its way.';

    orderId.textContent = data.order_id || 'Confirmed';
    paymentStatus.textContent = 'Paid';
    orderTotal.textContent = formatMoney(data.total_cents, data.currency || 'USD');

    details.hidden = false;
  };

  const showPending = () => {
    title.textContent = 'Payment confirmation pending';
    message.textContent =
      'We are still confirming your payment. Please do not submit the order again. Your cart has been retained.';
  };

  const showFailed = (status) => {
    title.textContent = status === 'expired' ? 'Checkout expired' : 'Payment unsuccessful';
    message.textContent =
      'Your checkout session is no longer active. Your cart has been retained, so you can return to the shop and try again.';
  };

  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(
        `/api/order-status?session_id=${encodeURIComponent(sessionId)}`
      );

      if (!response.ok) {
        throw new Error('Status unavailable');
      }

      const data = await response.json();

      if (data.status === 'paid') {
        showPaid(data);
        return;
      }

      if (data.status === 'failed' || data.status === 'expired') {
        showFailed(data.status);
        return;
      }
    } catch (error) {
      // Keep polling; Stripe webhooks can arrive shortly after redirect.
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  showPending();
})();
