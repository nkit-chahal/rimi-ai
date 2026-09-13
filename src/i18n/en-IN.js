const enIN = {
  appName: 'RIMI AI',
  nav: {
    dashboard: 'Pipeline Studio',
    pattern: 'Pattern Extraction',
    seamless: 'Make Seamless',
    repeat: 'Repeat Set',
    mappings: 'Mappings',
    inspire: 'Inspirations',
    vectorize: 'Vectorize',
    upscale: 'Super Resolution',
    removebg: 'Remove Background',
    imagelayers: 'Qwen Studio',
    colorways: 'Colorways',
    'colorway-manager': 'Colorway Manager',
    vectorpro: 'Vector Pro',
    mockup3d: '3D Mockup',
    'emb-placement': 'Placement',
    'emb-motifs': 'Motif Library',
    'emb-threads': 'Thread Shades',
    'emb-stitches': 'Stitch Styles',
    'emb-applique': 'Appliqué',
    'emb-mockups': 'Mockups',
    'emb-techpack': 'Tech Pack',
    'wv-checks': 'Checks & Stripes',
    'wv-weave': 'Weave Designer',
    'wv-jacquard': 'Jacquard',
    'wv-yarns': 'Yarn Library',
    'wv-visualizer': 'Weave Visualizer',
    library: 'Brand Library',
    measurement: 'Measurement',
    'print-advisor': 'Print Advisor',
    exports: 'Exports',
    billing: 'Billing',
    workspace: 'Workspace',
    'admin-dashboard': 'Dashboard',
    'admin-users': 'User Management',
    'admin-projects': 'Projects',
    'admin-logs': 'Activity Logs',
    'admin-credits': 'Credits & Billing',
  },
  navSections: {
    aiTools: 'AI DESIGN TOOLS',
    print: 'PRINT TOOLS',
    embroidery: 'EMBROIDERY TOOLS',
    woven: 'WOVEN TOOLS',
    assets: 'ASSETS & LIBRARY',
    admin: 'SUPERVISOR PANEL',
  },
  login: {
    welcomeBack: 'Welcome Back',
    verifyEmail: 'Verify Email',
    finishGoogleSignup: 'Finish Google Signup',
    subtitle: 'Access the generative pattern intelligence studio.',
    signIn: 'Sign in',
    signUp: 'Sign up',
    signingIn: 'Signing in...',
    sendVerificationCode: 'Send verification code',
    sendingCode: 'Sending code...',
    continueWithGoogle: 'Continue with Google',
    devOtp: 'Development OTP',
  },
};

export function t(key) {
  const parts = key.split('.');
  let value = enIN;
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) return key;
  }
  return value;
}

export default enIN;
