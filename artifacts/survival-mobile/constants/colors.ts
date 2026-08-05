/**
 * Dark-only theme matching the Survival Challenge aesthetic from tracker.html.
 * Palette: deep navy/black with green/amber/red signal colors.
 */
const colors = {
  light: {
    // Surfaces
    background: '#0E1116',
    foreground: '#C9D1D9',
    card: '#161B22',
    card2: '#1B222B',
    cardForeground: '#C9D1D9',

    // Legacy aliases
    text: '#C9D1D9',
    tint: '#3FB950',

    // Primary = green (edge/win)
    primary: '#3FB950',
    primaryForeground: '#0E1116',

    // Secondary
    secondary: '#1B222B',
    secondaryForeground: '#C9D1D9',

    // Muted
    muted: '#1B222B',
    mutedForeground: '#6E7681',

    // Accent = amber (reflex/warning)
    accent: '#D29922',
    accentForeground: '#0E1116',

    // Destructive = red (loss/danger)
    destructive: '#F85149',
    destructiveForeground: '#C9D1D9',

    // Info blue
    info: '#58A6FF',

    // Borders
    border: '#232A33',
    input: '#232A33',
  },

  dark: {
    // Same as light — this is a dark-only app
    background: '#0E1116',
    foreground: '#C9D1D9',
    card: '#161B22',
    card2: '#1B222B',
    cardForeground: '#C9D1D9',
    text: '#C9D1D9',
    tint: '#3FB950',
    primary: '#3FB950',
    primaryForeground: '#0E1116',
    secondary: '#1B222B',
    secondaryForeground: '#C9D1D9',
    muted: '#1B222B',
    mutedForeground: '#6E7681',
    accent: '#D29922',
    accentForeground: '#0E1116',
    info: '#58A6FF',
    destructive: '#F85149',
    destructiveForeground: '#C9D1D9',
    border: '#232A33',
    input: '#232A33',
  },

  radius: 10,
};

export default colors;
