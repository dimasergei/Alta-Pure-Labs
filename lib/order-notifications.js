const { clients, checked } = require('./backend');

const NOTIFICATION_TYPES = [
  'confirmation',
  'processing',
  'partially_shipped',
  'shipped',
  'tracking_updated',
  'delivered',
  'canceled'
];

async function queueStatusNotification({
  orderId,
  customerEmail,
  notificationType,
  eventKey
}) {
  if (
    typeof orderId !== 'string' ||
    orderId.length !== 36 ||
    typeof customerEmail !== 'string' ||
    !customerEmail.includes('@') ||
    !NOTIFICATION_TYPES.includes(notificationType) ||
    typeof eventKey !== 'string' ||
    !eventKey ||
    eventKey.length > 200
  ) {
    throw new Error('Invalid notification request.');
  }

  const { db } = clients();
  const findExisting = () => db
    .from('order_status_notifications')
    .select('id,status')
    .eq('order_id', orderId)
    .eq('notification_type', notificationType)
    .eq('event_key', eventKey)
    .in('status', ['pending', 'sent'])
    .maybeSingle();

  const existing = checked(await findExisting());
  if (existing) {
    return { id: existing.id, status: existing.status, created: false };
  }

  try {
    const notification = checked(
      await db
        .from('order_status_notifications')
        .insert({
          order_id: orderId,
          customer_email: customerEmail,
          notification_type: notificationType,
          event_key: eventKey,
          status: 'pending'
        })
        .select('id,status,created_at')
        .single()
    );
    return { id: notification.id, status: notification.status, created: true };
  } catch (error) {
    const raced = checked(await findExisting());
    if (raced) {
      return { id: raced.id, status: raced.status, created: false };
    }
    throw error;
  }
}

async function markNotificationSent({ notificationId, providerMessageId }) {
  const { db } = clients();
  return checked(
    await db
      .from('order_status_notifications')
      .update({
        status: 'sent',
        provider_message_id: providerMessageId || null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null
      })
      .eq('id', notificationId)
      .eq('status', 'pending')
      .select('id,status,sent_at')
      .maybeSingle()
  );
}

async function markNotificationFailed({ notificationId, error, attempts = 1 }) {
  const { db } = clients();
  return checked(
    await db
      .from('order_status_notifications')
      .update({
        status: 'failed',
        attempts,
        last_error: String(error || 'Unknown error').slice(0, 1000),
        updated_at: new Date().toISOString()
      })
      .eq('id', notificationId)
      .eq('status', 'pending')
      .select('id,status,attempts,last_error')
      .maybeSingle()
  );
}

module.exports = {
  NOTIFICATION_TYPES,
  queueStatusNotification,
  markNotificationSent,
  markNotificationFailed
};
