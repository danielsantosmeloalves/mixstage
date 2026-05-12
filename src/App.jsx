import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Catalogo from './pages/Catalogo'
import Mixer from './pages/Mixer'
import Admin from './pages/Admin'

const ADMIN_EMAIL = 'danielsantosmeloalves@gmail.com'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: 4 }}>MIXSTAGE</div>
    </div>
  )

  const isAdmin = session?.user?.email === ADMIN_EMAIL

  return (
    <Routes>
      <Route path="/login" element={!session ? <Login /> : <Navigate to="/catalogo" />} />
      <Route path="/catalogo" element={session ? <Catalogo session={session} isAdmin={isAdmin} /> : <Navigate to="/login" />} />
      <Route path="/mixer/:id" element={session ? <Mixer session={session} /> : <Navigate to="/login" />} />
      <Route path="/admin" element={session && isAdmin ? <Admin session={session} /> : <Navigate to="/login" />} />
      <Route path="*" element={<Navigate to={session ? "/catalogo" : "/login"} />} />
    </Routes>
  )
}
