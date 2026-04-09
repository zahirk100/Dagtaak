// api/stripe-webhook.js
// Vercel Serverless Function — verwerkt Stripe betalingen automatisch

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

// Supabase admin client — heeft service role key nodig om plan te updaten
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verifieer dat het verzoek echt van Stripe komt
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  console.log('Stripe event ontvangen:', event.type);

  try {
    switch (event.type) {

      // Betaling geslaagd — zet gebruiker op Pro
      case 'checkout.session.completed':
      case 'invoice.payment_succeeded': {
        const email = event.data.object.customer_email ||
                      event.data.object.customer_details?.email;
        if (email) {
          await setPlan(email, 'pro');
          console.log(`✅ Pro geactiveerd voor: ${email}`);
        }
        break;
      }

      // Abonnement opgezegd of betaling mislukt — zet terug naar gratis
      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const customerId = event.data.object.customer;
        if (customerId) {
          const customer = await stripe.customers.retrieve(customerId);
          const email = customer.email;
          if (email) {
            await setPlan(email, 'free');
            console.log(`⬇️ Terug naar gratis voor: ${email}`);
          }
        }
        break;
      }

      default:
        console.log(`Onbekend event type: ${event.type}`);
    }

    res.status(200).json({ received: true });

  } catch (err) {
    console.error('Fout bij verwerken event:', err);
    res.status(500).json({ error: 'Interne fout' });
  }
}

// Plan updaten in Supabase
async function setPlan(email, plan) {
  const { error } = await supabase
    .from('profiles')
    .update({ plan })
    .eq('email', email);

  if (error) {
    throw new Error(`Supabase update mislukt voor ${email}: ${error.message}`);
  }
}

// Raw body lezen voor Stripe signature verificatie
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Vercel config — raw body nodig voor Stripe signature
export const config = {
  api: {
    bodyParser: false,
  },
};
