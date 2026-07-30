-- ============================================================================
-- VINIX SDR — Datos de ejemplo para pruebas (OPCIONAL)
-- Ejecutar DESPUÉS de schema.sql en Supabase > SQL Editor.
-- Crea 1 campaña demo + 6 leads en distintos estados + 1 email + 2 respuestas,
-- para ver el panel completo funcionando sin importar nada.
-- ============================================================================

do $$
declare
  v_campaign uuid;
  v_lead_sent uuid;
  v_lead_interested uuid;
  v_email uuid;
begin
  -- Campaña demo
  insert into campaigns (name, value_proposition, sender_name, sender_email, base_template)
  values (
    'DEMO — Agencias web Barcelona',
    'Llenamos el calendario de discovery calls de agencias de marketing digital; 5-10 reuniones cualificadas al mes sin que el equipo pierda tiempo prospectando.',
    'Jorge',
    'jorge@ejemplo.com',
    ''
  )
  returning id into v_campaign;

  -- Lead 1: pendiente (para probar "Investigar")
  insert into leads (campaign_id, company_name, company_url, contact_name, contact_email, contact_role)
  values (v_campaign, 'Estudi Nou Digital', 'https://example.com', 'Marta Puig', 'marta@estudinovdigital.example', 'Directora');

  -- Lead 2: pendiente sin URL (para probar el fallo explícito de investigación)
  insert into leads (campaign_id, company_name, contact_name, contact_email)
  values (v_campaign, 'Agencia Sin Web SL', 'Carlos Vidal', 'carlos@sinweb.example');

  -- Lead 3: investigación fallida (revisión manual)
  insert into leads (campaign_id, company_name, company_url, contact_email, status, research_error)
  values (v_campaign, 'WebCrafters BCN', 'https://webcrafters.example', 'info@webcrafters.example',
          'research_failed', 'Scraping falló: Timeout de scraping (25000ms)');

  -- Lead 4: borrador listo (para probar el modal de aprobación)
  insert into leads (campaign_id, company_name, company_url, contact_name, contact_email, status,
                     research_sector, research_size, research_pain_point, draft_subject, draft_body)
  values (v_campaign, 'Pixel & Co', 'https://pixelco.example', 'Anna Serra', 'anna@pixelco.example',
          'ready_to_send', 'Agencia de diseño web', 'pyme ~12 empleados',
          'Acaban de abrir oficina en Madrid y buscan 2 perfiles comerciales',
          'lo de vuestra oficina en Madrid',
          'Anna, he visto que acabáis de abrir oficina en Madrid y estáis buscando perfiles comerciales.' || chr(10) || chr(10) ||
          'Mientras esos fichajes llegan, nosotros llenamos el calendario de discovery calls de agencias como la vuestra: la media son 5-10 reuniones cualificadas al mes.' || chr(10) || chr(10) ||
          '¿Es algo relevante para vosotros ahora mismo?' || chr(10) || chr(10) || 'Jorge');

  -- Lead 5: enviado (esperando respuesta)
  insert into leads (campaign_id, company_name, company_url, contact_email, status,
                     research_sector, research_pain_point)
  values (v_campaign, 'Nordweb Studio', 'https://nordweb.example', 'hola@nordweb.example', 'sent',
          'Desarrollo web', 'Publicaron que rechazan proyectos por falta de capacidad comercial')
  returning id into v_lead_sent;

  insert into emails_sent (lead_id, campaign_id, subject, body, provider_message_id, word_count)
  values (v_lead_sent, v_campaign, 'sobre los proyectos que rechazáis',
          'He leído que estáis rechazando proyectos por falta de capacidad. Nosotros… (email demo)',
          'demo-message-id-0001', 54)
  returning id into v_email;

  -- Lead 6: interesado con respuesta clasificada
  insert into leads (campaign_id, company_name, company_url, contact_email, status,
                     research_sector, research_pain_point)
  values (v_campaign, 'Mediterrani Apps', 'https://mediterrani.example', 'dir@mediterrani.example', 'interested',
          'Desarrollo de apps', 'Expansión a mercado francés anunciada en su blog')
  returning id into v_lead_interested;

  insert into replies (lead_id, raw_body, raw_headers, classification, classification_confidence,
                       agent_response_draft, agent_response_sent, processed_at)
  values (v_lead_interested,
          'Hola Jorge, pues sí que nos interesa. ¿Cómo funciona exactamente? ¿Podemos hablar esta semana?',
          '{"from": "dir@mediterrani.example", "subject": "Re: lo de vuestra expansión a Francia"}'::jsonb,
          'interested', 0.92,
          'Gracias por la respuesta. Te propongo dos huecos: martes a las 10:00 o miércoles a las 16:00 (CET). ¿Te encaja alguno o prefieres otro momento?',
          false, now());

  -- Respuesta huérfana marcada para revisión (para ver la bandeja ámbar)
  insert into replies (lead_id, raw_body, raw_headers, classification, classification_confidence,
                       flagged_for_review, review_reason)
  values (null,
          'Buenas, me reenvían este correo pero creo que no es para mí.',
          '{"from": "desconocido@example.com", "subject": "Re: propuesta"}'::jsonb,
          'unclear', 0, true, 'orphaned_reply');
end $$;
