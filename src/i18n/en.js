export default {
  app: 'Tracking the Gathering',
  tagline: 'Your Commander nights. Every game, every salty moment, every rematch.',

  nav: { start: 'Home', play: 'Play', history: 'History', board: 'Rankings', me: 'Profile' },

  auth: {
    email: 'Email', password: 'Password', name: 'Display name', namePh: 'How your group sees you',
    login: 'Sign in', register: 'Create account', forgot: 'Forgot password', haveAccount: 'I already have an account',
    noAccount: 'No account yet?', haveAccountQ: 'Already have an account?', showPw: 'Show password', hidePw: 'Hide password',
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
      'A user with this email address has already been registered': 'An account with this email already exists.',
    },
  },

  welcome: {
    title: 'Hi {name}', sub: 'Create your first playgroup or join one. Someone in the group can give you the code.',
    create: 'Create playgroup', join: 'Enter code',
  },

  home: {
    newRound: 'Ready for the next round?', newRoundSub: 'Pick players, assign decks, roll for who starts.',
    players: 'Your table', addShort: 'Add',
    newGame: 'New game', joinGame: 'Join game', joinSoon: 'Live mode arrives in stage 6.',
    leaderboard: 'Rankings', recent: 'Recently played', all: 'See all',
    noGames: 'No games yet', noGamesSub: 'After your first game, this shows who is ahead.',
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
    looks: { nacht: 'Night', arktis: 'Arctic', lachs: 'Salmon' },
  },

  avatar: {
    title: 'Profile picture', take: 'Take photo', gallery: 'Choose from gallery', remove: 'Remove picture',
    hint: 'The picture is cropped square and stored small. Without a picture, initials are shown.',
    forWhom: 'for {name}', change: 'Change profile picture of {name}', saved: 'Profile picture saved.', removed: 'Profile picture removed.',
    tooBig: 'The picture could not be read.',
  },

  decks: {
    add: 'Add commander', addFor: 'for {name}', search: 'Search commander', searchPh: 'Type a name, e.g. Atraxa',
    searchPartner: 'Search partner', noResults: 'No commander found.', searching: 'Searching …', searchError: 'Scryfall is not reachable right now. Please try again shortly.',
    typeMore: 'Type at least two letters.', change: 'Choose another', partnerTag: 'Partner',
    addPartner: 'Add partner', partnerHint: { partner: 'Has “Partner”: you can add a second commander with Partner.', with: 'Belongs together with {name}.', friends: 'Has “Friends forever”.', background: 'Can choose a Background.', doctor: 'Can add a Doctor’s companion.', companion: 'Can add a Doctor.' },
    removePartner: 'Remove partner', bracket: 'Bracket', bracketHint: 'How strong is the deck? 1 = Exhibition, 5 = cEDH.',
    link: 'Link to decklist', linkPh: 'moxfield.com/decks/…', linkHint: 'Optional. Moxfield and Archidekt are recognised.', linkBad: 'That does not look like a link.',
    save: 'Save deck', saved: 'Deck saved.', none: 'No deck yet.', noneOther: '{name} has no deck yet.',
    games: 'Games', wins: 'Wins', winrate: 'Win rate', place: 'Avg place', noGames: 'No games yet', list: 'Decklist',
    open: 'Open', editLink: 'Change link', addLink: 'Add link', noLink: 'No link to a decklist yet.',
    changeBracket: 'Change bracket', remove: 'Remove deck', removed: 'Deck removed.', archived: 'Deck archived because it already appears in games.',
    removeConfirm: 'Really remove?', removeYes: 'Yes, remove', by: 'by {name}', notFound: 'This deck does not exist or is not visible to you.',
    art: 'Art: {artist} · Scryfall',
  },

  settings: {
    account: 'Account', accountSub: 'Password, email, delete account', about: 'About the app',
    legal: 'Legal & credits', legalSub: 'Fan content notice, imprint, licenses', privacy: 'Privacy', version: 'Version',
  },

  account: {
    title: 'Account', signedInAs: 'Signed in as {email}',
    pwTitle: 'Change password', pwNew: 'New password', pwRepeat: 'Repeat new password', pwSave: 'Change password',
    pwDone: 'Password changed.', pwMismatch: 'The two passwords do not match.', pwSame: 'The new password must differ from the old one.',
    emailTitle: 'Change email', emailNew: 'New email address', emailSave: 'Send confirmation links',
    emailHint: 'We send a confirmation link to your old and to your new address. The new address applies once you have opened both links.',
    emailSent: 'Links are on their way. Please confirm in both inboxes.',
    emailBad: 'That does not look like an email address.', emailSame: 'That is already your address.',
    dangerTitle: 'Delete account', dangerSub: 'Permanent. Cannot be undone.', delete: 'Delete account',
    deleteTitle: 'Really delete your account?',
    deleteGone: 'Gone: your account, your profile and picture, and your decks that never appeared in a game.',
    deleteKept: 'Kept for your groups: shared games and statistics. You will appear there as “Ehemaliges Mitglied” (former member); played decks are archived.',
    deleteSolo: 'Playgroups where nobody else has an account are deleted together with their games. If you are the last admin, the longest-standing member becomes admin.',
    deleteType: 'Type {word} to confirm', deleteYes: 'Delete permanently', deleted: 'Your account has been deleted.',
  },

  legal: {
    title: 'Legal & credits', pending: 'Details to follow',
    fanTitle: 'Fan content',
    fan: 'Tracking the Gathering is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
    fanLink: 'Read the Fan Content Policy',
    creditsTitle: 'Credits',
    scryfall: 'Card data and card images', icons: 'Icons', iconsLic: 'Phosphor Icons · MIT license',
    fonts: 'Fonts', fontsLic: 'Bricolage Grotesque, Geist, Unbounded · SIL Open Font License 1.1 · self-hosted',
    imprintTitle: 'Imprint', privacyLink: 'Privacy policy', version: 'App version {v}',
  },

  privacy: {
    title: 'Privacy', updated: 'As of November 2026',
    intro: 'This page explains which data Tracking the Gathering processes, where it is stored and which rights you have.',
    controllerTitle: 'Controller',
    sections: [
      { h: 'What is stored', p: [
        'Account: email address, password (only as an encrypted hash), display name, language, appearance and optionally a profile picture.',
        'Group data: playgroups, members (including players without an account), decks, games, game events and ratings. Only members of the same playgroup can see this data.',
        'The sole purpose is running the app for you and your group (Art. 6(1)(b) GDPR).'] },
      { h: 'Supabase (servers in Frankfurt, EU)', p: [
        'Sign-in, database and image storage run at Supabase in the Frankfurt am Main region (EU). Supabase processes the data on our behalf.'] },
      { h: 'Scryfall (USA)', p: [
        'Card images and the commander search come directly from Scryfall (scryfall.com). Your device sends your IP address and the search term to Scryfall in the USA. No account or group data goes to Scryfall.'] },
      { h: 'GitHub Pages and esm.sh (delivering the app)', p: [
        'The app files are hosted on GitHub Pages (GitHub Inc., USA). When you open the app, GitHub processes technically necessary data such as IP address and time.',
        'The sign-in library (supabase-js) is loaded from esm.sh at startup; this also transmits your IP address.',
        'Fonts are part of the app itself; there are no requests to Google Fonts.'] },
      { h: 'No trackers', p: [
        'No analytics, no ads, no third-party cookies. In your browser the app only stores what it needs to work: your sign-in, language, look, selected playgroup, game events not yet sent and the app files for offline use.'] },
      { h: 'Retention and deletion', p: [
        'Data is kept as long as your account exists. Under Settings → Account you can delete your account yourself at any time. Your account, profile, picture and unplayed decks are then gone. Shared games remain for the group; you appear there as “Ehemaliges Mitglied” (former member) without name or picture.'] },
      { h: 'Your rights', p: [
        'You have the right of access, rectification, erasure, restriction of processing, data portability and objection. You may also lodge a complaint with a data protection supervisory authority. For requests, contact the controller named above.'] },
    ],
  },

  common: { back: 'Back', close: 'Close', cancel: 'Cancel', loading: 'Loading …', error: 'Something went wrong.' },
};
