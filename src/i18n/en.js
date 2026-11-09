export default {
  app: 'Tracking the Gathering',
  tagline: 'Your Commander nights. Every game, every salty moment, every rematch.',

  nav: { start: 'Home', play: 'Play', history: 'History', board: 'Rankings', me: 'Profile' },

  auth: {
    email: 'Email', password: 'Password', name: 'Display name', namePh: 'How your group sees you',
    login: 'Sign in', register: 'Create account', forgot: 'Forgot password', haveAccount: 'I already have an account',
    pwHint: 'At least 8 characters.',
    registerTitle: 'Create account', registerSub: 'Afterwards you create a playgroup or join one with a code.',
    forgotTitle: 'Forgot password', forgotSub: 'We will send you a link to set a new password.',
    sendLink: 'Send link', linkSent: 'If an account with this address exists, the link is on its way.',
    newPwTitle: 'New password', newPwSave: 'Save password', newPwDone: 'Password changed.',
    checkMail: 'Almost there: please confirm your email address using the link we sent you.',
    pendingCode: 'After signing in, code {code} will be redeemed.',
    errors: {
      'Invalid login credentials': 'Email or password is wrong.',
      'User already registered': 'An account with this email already exists.',
      'Email not confirmed': 'Please confirm your email address first.',
      weak: 'The password needs at least 8 characters.',
      name: 'Please enter a name with 1 to 40 characters.',
      rate: 'Too many attempts. Please wait a moment.',
      generic: 'That did not work. Please try again.',
      offline: 'No connection. Please check your internet.',
    },
  },

  welcome: {
    title: 'Welcome, {name}!', sub: 'Create your first playgroup or join one. Someone in the group can give you the code.',
    create: 'Create playgroup', join: 'Enter code',
  },

  home: {
    newRound: 'New round?', newRoundSub: 'Pick players, assign decks, roll for who starts.',
    newGame: 'New game', joinGame: 'Join game', joinSoon: 'Live mode arrives in stage 6.',
    leaderboard: 'Rankings', recent: 'Recently played', all: 'See all',
    noGames: 'No games yet', noGamesSub: 'Once you play, your latest games and the rankings show up here.',
    switchGroup: 'Switch playgroup',
  },

  soon: {
    play: { title: 'Life counter coming soon', sub: 'Setup, seating, life counter with drag-to-attack and the dice table arrive in stage 3.' },
    history: { title: 'History coming soon', sub: 'Saved games grouped by game night arrive in stage 4.' },
    board: { title: 'Rankings coming soon', sub: 'Points, decks and salt rankings arrive in stage 5.' },
  },

  groups: {
    title: 'Playgroups', newGroup: 'New playgroup', groupName: 'Playgroup name', groupNamePh: 'e.g. Kitchen table',
    create: 'Create', created: 'Playgroup created.',
    enterCode: 'Enter code', codeLabel: 'Invite or player code', codePh: 'TTG-XXXXXX', redeem: 'Redeem',
    codeHint: 'Invite codes start with TTG-. With a personal code (e.g. TIM-…) you take over your profile including its history.',
    invite: 'Invite', copy: 'Copy', copyLink: 'Copy link', copied: 'Copied.', shareText: 'Join our playgroup “{name}” on Tracking the Gathering:',
    inviteHint: 'Share the code or link. Whoever redeems it becomes a member of this playgroup.',
    members: 'Members', addPlaceholder: 'Add player without account',
    addPlaceholderHint: 'For people who do not want to sign up. They can take over their profile later with a code.',
    roles: { admin: 'Admin', member: 'Member', guest: 'No account' },
    membersCount: '{n} members', membersCountOne: '1 member', membersCountGuests: '{n} members · {g} without account',
    joined: 'Welcome to “{name}”.', claimed: 'Profile taken over. Your games are yours now.',
    codeWrong: 'We do not know this code. Please check it again.',
  },

  addPlayer: {
    title: 'Add player', name: 'Name', namePh: 'e.g. Max', create: 'Add player',
    noAccount: 'No account needed',
    noAccountText: 'The player gets their own profile with stats and decks. If they sign up later, give them the code from their profile. With it they take over everything, including the full history.',
    created: '{name} has been added.',
  },

  profile: {
    since: '{group} · member since {date}',
    stats: { games: 'Games', wins: 'Wins', points: 'Points', place: 'Avg place' },
    guestTitle: '{name} has no account yet',
    guestText: 'All games are still collected here. As soon as {name} signs up and enters this code, the profile and history belong to them.',
    decks: 'Decks', decksSoon: 'Decks with commander search arrive in stage 2.',
    settings: 'Settings', language: 'Language', look: 'Appearance', manageGroups: 'Manage playgroups',
    logout: 'Sign out', rename: 'Change name', save: 'Save', saved: 'Saved.',
    makeAdmin: 'Make admin', removeAdmin: 'Remove admin rights', roleChanged: 'Role changed.',
    notFound: 'This profile does not exist or is not visible to you.',
    looks: { schiefer: 'Slate', gletscher: 'Glacier', obsidian: 'Obsidian' },
  },

  avatar: {
    title: 'Profile picture', take: 'Take photo', gallery: 'Choose from gallery', remove: 'Remove picture',
    hint: 'The picture is cropped square and stored small. Without a picture, initials are shown.',
    forWhom: 'for {name}', change: 'Change profile picture of {name}', saved: 'Profile picture saved.', removed: 'Profile picture removed.',
    tooBig: 'The picture could not be read.',
  },

  common: { back: 'Back', close: 'Close', cancel: 'Cancel', loading: 'Loading …', error: 'Something went wrong.' },
};
