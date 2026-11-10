-- ============================================================
-- L2i CRM — username sign-up, no email step.
-- Run after 03_hardening.sql. Safe to re-run.
--
-- People sign in with a username and password. Behind the scenes each
-- account is stored as <username>@l2i.local, already confirmed, so
-- Supabase never sends (or waits for) a confirmation email.
-- New accounts still wait for the Owner's approval before they see anything.
-- ============================================================
create or replace function public.l2i_sign_up(p_username text, p_password text, p_full_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user  text := lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));
  v_name  text := nullif(trim(coalesce(p_full_name, '')), '');
  v_email text;
  v_id    uuid := gen_random_uuid();
begin
  if v_user !~ '^[a-z0-9._]{3,20}$' then
    raise exception 'Usernames are 3 to 20 letters, numbers, dots or underscores';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  if v_name is null then
    raise exception 'Enter your name';
  end if;
  v_email := v_user || '@l2i.local';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'That username is taken';
  end if;
  -- keeps the open sign-up from being used to flood the approval queue
  if (select count(*) from public.profiles where not approved) >= 25 then
    raise exception 'Too many sign-ups are waiting for approval. Ask the Owner to clear the queue.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', v_name, 'username', v_user), now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          now(), now(), now());

  return jsonb_build_object('username', v_user);
end $$;

grant execute on function public.l2i_sign_up(text, text, text) to anon, authenticated;
