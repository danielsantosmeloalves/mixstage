import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://jdpqktgkarslrnfgtppo.supabase.co'
const SUPABASE_KEY = 'sb_publishable_m8CzdyeblrC5mLdn2cbL1w_fIX2-ZPG'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
