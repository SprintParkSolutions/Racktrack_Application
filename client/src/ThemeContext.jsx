import { createContext, useContext, useEffect } from 'react';

/* Single-theme app — white Material 3 surface with black accent.
   Kept as a context so existing call sites (useTheme, ThemeToggle) keep
   working, but `theme` is always 'light' and toggleTheme is a no-op. */
const THEME = 'light';

const ThemeContext = createContext({
  theme: THEME,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', THEME);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: THEME, setTheme: () => {}, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
