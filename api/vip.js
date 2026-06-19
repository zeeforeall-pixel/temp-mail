// Path 4: Vercel serverless proxy for VIP inbox creation
// Bypasses anon RLS by using service_role key from environment
// Frontend calls: POST /api/vip with {prefix, domain}

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prefix, domain } = req.body || {};

  if (!prefix || !domain) {
    return res.status(400).json({ error: 'prefix and domain required' });
  }

  // Validate service_role key exists in environment
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE not set in Vercel environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabaseUrl = 'https://ijrccpgiulrmfpavazsl.supabase.co';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  try {
    // Generate password server-side
    const password = Math.random().toString(36).slice(2, 18);
    const address = `${prefix.toLowerCase()}@${domain}`;

    // Insert with is_vip=true using service_role (bypasses anon RLS)
    const { data, error } = await supabase
      .from('temp_inboxes')
      .insert({
        address,
        domain,
        owner_token: req.body.owner_token || crypto.randomUUID(),
        password_plain: password,
        is_vip: true
      })
      .select('address, expires_at, is_vip')
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      address: data.address,
      expires_at: data.expires_at,
      password: password,
      is_vip: data.is_vip
    });
  } catch (error) {
    console.error('VIP inbox creation failed:', error);
    return res.status(500).json({
      error: 'Failed to create VIP inbox',
      details: error.message
    });
  }
}
