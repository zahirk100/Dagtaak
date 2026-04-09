// api/stripe-webhook.js
// Vercel Serverless Function — verwerkt Stripe betalingen automatisch

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook verificatie mislukt:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log('Stripe event:', event.type);

  try {
    switch (event.type) {

      case 'checkout.session.completed':
      case 'invoice.payment_succeeded': {
        const email = event.data.object.customer_email ||
                      event.data.object.customer_details?.email;
        if (email) {
          await setPlan(email, 'pro');
          console.log('Pro geactiveerd voor:', email);
        }
        break;
      }

      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const customerId = event.data.object.customer;
        if (customerId) {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer.email) {
            await setPlan(customer.email, 'free');
            console.log('Terug naar gratis voor:', customer.email);
          }
        }
        break;
      }

      default:
        console.log('Onbekend event:', event.type);
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error('Fout bij verwerken:', err);
    res.status(500).json({ error: 'Interne fout' });
  }
};

async function setPlan(email, plan) {
  const { error } = await supabase
    .from('profiles')
    .update({ plan })
    .eq('email', email);
  if (error) throw new Error(`Supabase fout: ${error.message}`);
}

module.exports.config = {
  api: { bodyParser: false },
};
