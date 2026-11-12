// Namensräume der Spiel-Pakete (Naht aus P7): je Paket eine eigene Datei, hier nur eingebunden.
import setup from './de-setup.js';
import life from './de-life.js';
import dice from './de-dice.js';
import attack from './de-attack.js';
import ko from './de-ko.js';
import intro from './de-intro.js';
// Namensräume der Welle ttg-live-feinschliff-decks (Naht P3): decklist = P5, live = P6, table = P7.
import decklist from './de-decklist.js';
import live from './de-live.js';
import table from './de-table.js';

export default {
  app: 'Tracking the Gathering',
  tagline: 'Eure Commander-Runden. Jedes Spiel, jeder Salt-Moment, jede Revanche.',

  nav: { start: 'Start', play: 'Spielen', history: 'Historie', board: 'Rangliste', me: 'Profil' },

  auth: {
    email: 'E-Mail', password: 'Passwort', name: 'Anzeigename', namePh: 'So sieht dich deine Gruppe',
    login: 'Anmelden', register: 'Konto erstellen', forgot: 'Passwort vergessen', haveAccount: 'Ich habe schon ein Konto',
    noAccount: 'Noch kein Konto?', haveAccountQ: 'Schon ein Konto?', showPw: 'Passwort anzeigen', hidePw: 'Passwort verbergen',
    pwHint: 'Mindestens 8 Zeichen.',
    registerTitle: 'Konto erstellen', registerSub: 'Mit dem Einladungscode deiner Gruppe bist du gleich dabei.',
    inviteCode: 'Einladungscode', inviteCodeHint: 'Den Code bekommst du von deiner Gruppe.', joining: 'Du trittst „{name}“ bei.',
    forgotTitle: 'Passwort vergessen', forgotSub: 'Wir schicken dir einen Link, mit dem du ein neues Passwort setzt.',
    sendLink: 'Link schicken', linkSent: 'Falls es ein Konto mit dieser Adresse gibt, ist der Link unterwegs.',
    newPwTitle: 'Neues Passwort', newPwSave: 'Passwort speichern', newPwDone: 'Passwort geändert.',
    checkMail: 'Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in der Mail.',
    confirmTitle: 'Bestätige deine E-Mail',
    confirmText: 'Wir haben eine Mail an {email} geschickt. Öffne den Link darin, um dein Konto zu bestätigen.',
    confirmHint: 'Keine Mail da? Schau auch im Spam-Ordner nach. Hast du schon ein Konto, melde dich einfach an.',
    resend: 'Mail erneut senden', resendLogin: 'Bestätigungsmail erneut senden', resendWait: 'Erneut senden in {s} s',
    resendSent: 'Falls die Adresse auf eine Bestätigung wartet, ist eine neue Mail unterwegs.', toLogin: 'Zur Anmeldung',
    pendingCode: 'Nach der Anmeldung wird der Code {code} eingelöst.',
    errors: {
      'Invalid login credentials': 'E-Mail oder Passwort stimmt nicht.',
      'User already registered': 'Mit dieser E-Mail gibt es schon ein Konto.',
      'Email not confirmed': 'Bitte bestätige zuerst deine E-Mail-Adresse.',
      weak: 'Das Passwort braucht mindestens 8 Zeichen.',
      name: 'Bitte gib einen Namen mit 1 bis 40 Zeichen ein.',
      rate: 'Zu viele Versuche. Bitte warte kurz.',
      generic: 'Das hat nicht geklappt. Bitte versuch es nochmal.',
      offline: 'Keine Verbindung. Bitte prüfe dein Internet.',
      'A user with this email address has already been registered': 'Mit dieser E-Mail gibt es schon ein Konto.',
      // Kennwörter aus dem P9-Vertrag (Datenbank)
      superadmin_only: 'Das darf nur der Betreiber der App.',
      superadmin_cannot_delete: 'Das Verwaltungskonto lässt sich nicht löschen.',
      not_group_admin: 'Das dürfen nur die Admins dieser Gruppe.',
      max_accounts_range: 'Bitte eine ganze Zahl von 1 bis 1000.',
      signup_code_required: 'Bitte gib den Einladungscode deiner Gruppe ein.',
      signup_code_invalid: 'Diesen Code kennen wir nicht (mehr). Bitte frag in deiner Gruppe nach einem neuen.',
      signup_full: 'Zurzeit sind alle Plätze vergeben.',
      signup_anonymous_disabled: 'Ohne Konto geht es hier nicht. Bitte registriere dich mit einem Einladungscode.',
      // Kennwörter aus P10 (Mitglieder)
      member_removed: 'Dieser Spieler ist aus der Gruppe entfernt und kann nicht mehr mitspielen.',
      member_has_account: 'Mitglieder mit Konto kommen über den Einladungslink zurück.',
      member_state_changed: 'Inzwischen hat sich etwas geändert. Bitte prüf es nochmal.',
      member_files_pending: 'Das Profilbild ließ sich nicht löschen. Bitte versuch es nochmal.',
      group_not_found: 'Diese Gruppe gibt es nicht (mehr).',
      member_is_admin: 'Admins lassen sich nicht entfernen. Entzieh zuerst die Admin-Rechte.',
      member_is_self: 'Dich selbst entfernst du über „Gruppe verlassen“.',
      last_admin: 'Du bist der einzige Admin. Ernenne vorher einen weiteren Admin.',
      unavailable: 'Noch nicht verfügbar. Bitte später erneut versuchen.',
    },
  },

  welcome: {
    title: 'Hallo {name}', sub: 'Du brauchst einen Einladungslink von deiner Gruppe.',
    create: 'Playgroup anlegen', join: 'Code eingeben',
  },

  home: {
    newRound: 'Bereit für die nächste Runde?', newRoundSub: 'Spieler wählen, Decks zuordnen, Startspieler auswürfeln.',
    players: 'Eure Runde', addShort: 'Neu',
    newGame: 'Neues Spiel', joinGame: 'Spiel beitreten', joinSoon: 'Live-Modus kommt in Etappe 6.',
    leaderboard: 'Rangliste', recent: 'Zuletzt gespielt', all: 'Alle ansehen',
    noGames: 'Noch keine Spiele', noGamesSub: 'Nach eurem ersten Spiel steht hier, wer vorne liegt.',
    switchGroup: 'Playgroup wechseln',
  },

  soon: {
    play: { title: 'Lifecounter kommt bald', sub: 'Setup, Sitzordnung, Lifecounter mit Angriff per Ziehen und Würfeltisch kommen in Etappe 3.' },
    history: { title: 'Historie kommt bald', sub: 'Gespeicherte Spiele nach Spieleabenden gibt es ab Etappe 4.' },
    board: { title: 'Rangliste kommt bald', sub: 'Punkte, Decks und Salt-Rangliste kommen in Etappe 5.' },
  },
  result, history, board, recap, stats, // Etappe 4/5 (Naht P13)

  groups: {
    title: 'Playgroups', newGroup: 'Neue Playgroup', groupName: 'Name der Playgroup', groupNamePh: 'z. B. Küchentisch',
    create: 'Anlegen', created: 'Playgroup angelegt.',
    enterCode: 'Code eingeben', codeLabel: 'Einladungs- oder Spielercode', codePh: 'TTG-XXXXXX', redeem: 'Einlösen',
    codeHint: 'Einladungscodes beginnen mit TTG-. Hast du einen persönlichen Code (z. B. TIM-…), übernimmst du damit dein Profil samt Historie.',
    invite: 'Einladen', copy: 'Kopieren', copyLink: 'Link kopieren', copied: 'Kopiert.', shareText: 'Komm in unsere Playgroup „{name}“ bei Tracking the Gathering:',
    inviteHint: 'Code oder Link teilen. Wer ihn einlöst, wird Mitglied dieser Playgroup.',
    members: 'Mitglieder', addPlaceholder: 'Spieler ohne Konto anlegen',
    addPlaceholderHint: 'Für Leute, die sich nicht registrieren wollen. Sie können ihr Profil später mit einem Code übernehmen.',
    roles: { admin: 'Admin', member: 'Mitglied', guest: 'Ohne Konto' },
    membersCount: '{n} Mitglieder', membersCountOne: '1 Mitglied', membersCountGuests: '{n} Mitglieder · {g} ohne Konto',
    joined: 'Willkommen in „{name}“.', claimed: 'Profil übernommen. Deine Spiele sind jetzt bei dir.',
    codeWrong: 'Diesen Code kennen wir nicht. Bitte prüf ihn nochmal.',
    dangerTitle: 'Gruppe löschen', dangerSub: 'Nur für Admins. Löscht die Playgroup für alle Mitglieder.', deleteGroup: 'Gruppe löschen',
    deleteTitle: '„{name}“ löschen?',
    deleteWarn: 'Löscht {games}, {members}, {guests} samt Decks und Bildern. Das lässt sich nicht rückgängig machen.',
    deleteGames: '{n} Spiele', deleteGamesOne: '1 Spiel', deleteMembers: '{n} Mitgliedschaften', deleteMembersOne: '1 Mitgliedschaft',
    deleteGuests: '{n} Spieler ohne Konto', deleteGuestsOne: '1 Spieler ohne Konto',
    deleteKept: 'Bleiben: die Konten der Mitglieder, ihre eigenen Decks und ihre anderen Playgroups.',
    deleteType: 'Zum Bestätigen den Namen der Gruppe eingeben', deleteYes: 'Endgültig löschen', deleted: '„{name}“ wurde gelöscht.',
    deleteNameWrong: 'Der Name stimmt nicht.',
    deleteDeckElsewhere: 'Löschen geht nicht: Ein Deck eines Spielers ohne Konto aus dieser Gruppe kommt in Spielen einer anderen Playgroup vor. Deren Historie bleibt geschützt.',
    deleteMemberElsewhere: 'Löschen geht nicht: Spiele einer anderen Playgroup verweisen auf Mitglieder dieser Gruppe. Deren Historie bleibt geschützt.',
    joinLiveSoon: 'Live-Beitritt kommt gleich', joinLiveSoonSub: 'Bald trittst du hier mit Code oder Link einem laufenden Spiel bei.',
    shareLink: 'Link teilen', qr: 'QR-Code', qrTitle: 'Einladung zu „{name}“', qrAlt: 'QR-Code mit dem Einladungslink für „{name}“',
    qrHint: 'Mit der Handykamera scannen. Der Code führt zum selben Link wie „Link teilen“.',
    renew: 'Link erneuern', renewTitle: 'Link erneuern?', renewText: 'Der bisherige Link und QR-Code gelten dann nicht mehr.',
    renewYes: 'Neuen Link erstellen', renewed: 'Neuer Link ist aktiv.',
    inviteAdminsOnly: 'Einladen können die Admins dieser Gruppe.',
  },

  // P10: Spieler entfernen, wiederherstellen, Gruppe verlassen
  memberRemove: {
    button: 'Aus Gruppe entfernen', title: '{name} entfernen?', chip: 'Entfernt',
    deleteText: '{name} hat noch kein Spiel und wird vollständig gelöscht.',
    deleteTextAccount: '{name} hat noch kein Spiel in dieser Gruppe und wird aus der Gruppe entfernt. Das Konto bleibt bestehen.',
    deleteDecks: '{n} Decks werden mitgelöscht.', deleteDecksOne: '1 Deck wird mitgelöscht.',
    markGames: '{name} ist in {n} Spielen eingetragen.', markGamesOne: '{name} ist in einem Spiel eingetragen.',
    markGamesNone: '{name} kommt in der Historie vor.',
    markRest: 'Die Spiele bleiben erhalten. {name} verschwindet aus Mitgliederliste, Spielaufbau und Rangliste. Rückgängig unter Gruppe → Entfernte Spieler.',
    markRestAccount: 'Die Spiele bleiben erhalten. {name} sieht die Gruppe danach nicht mehr und verschwindet aus Mitgliederliste, Spielaufbau und Rangliste.',
    accountBack: 'Entfernen ist keine Sperre: Mit dem Einladungslink kommt {name} zurück. Soll {name} draußen bleiben, erneuere danach den Link.',
    live: 'Ein laufendes Spiel mit {name} läuft weiter.',
    again: 'Inzwischen hat sich etwas geändert. Bitte prüf es nochmal.',
    yesDelete: 'Endgültig löschen', yesMark: 'Entfernen',
    deleted: '{name} wurde gelöscht.', marked: '{name} wurde entfernt.', already: '{name} ist schon entfernt.',
    removedTitle: 'Entfernte Spieler', restore: 'Wiederherstellen', restored: '{name} ist wieder dabei.',
    viaInvite: 'kommt über den Einladungslink zurück', accountDeleted: 'Konto gelöscht',
    leave: 'Gruppe verlassen', leaveSub: 'Deine Spiele bleiben in der Historie.', leaveTitle: '„{name}“ verlassen?',
    leaveText: 'Du verlässt „{name}“. Deine Spiele bleiben in der Historie; du siehst die Gruppe danach nicht mehr. Über Verwaltung → Alle Gruppen kannst du sie wieder betreten.',
    leaveTextMember: 'Du verlässt „{name}“. Deine Spiele bleiben in der Historie; du siehst die Gruppe danach nicht mehr. Zurück kommst du mit einem Einladungslink.',
    leaveNoAdmin: 'Danach hat die Gruppe keinen Admin: niemand außer dir kann einladen oder Spieler entfernen. Ernenne vorher einen Admin.',
    leaveYes: 'Verlassen', left: 'Du hast „{name}“ verlassen.',
  },

  addPlayer: {
    title: 'Spieler anlegen', name: 'Name', namePh: 'z. B. Max', create: 'Spieler anlegen',
    noAccount: 'Kein Konto nötig',
    noAccountText: 'Der Spieler bekommt ein eigenes Profil mit Statistiken und Decks. Will er sich später registrieren, gibst du ihm seinen Code aus dem Profil. Damit übernimmt er alles, inklusive der kompletten Historie.',
    created: '{name} ist angelegt.',
  },

  profile: {
    since: '{group} · dabei seit {date}',
    stats: { games: 'Spiele', wins: 'Siege', points: 'Punkte', place: 'Ø Platz' },
    guestTitle: '{name} hat noch kein Konto',
    guestText: 'Alle Spiele werden trotzdem hier gesammelt. Sobald sich {name} registriert und diesen Code eingibt, gehören Profil und Historie ihm.',
    decks: 'Decks', decksSoon: 'Decks mit Commander-Suche kommen in Etappe 2.',
    settings: 'Einstellungen', language: 'Sprache', look: 'Erscheinungsbild', manageGroups: 'Playgroups verwalten',
    logout: 'Abmelden', rename: 'Namen ändern', save: 'Speichern', saved: 'Gespeichert.',
    makeAdmin: 'Zum Admin machen', removeAdmin: 'Admin-Rechte entziehen', roleChanged: 'Rolle geändert.',
    notFound: 'Dieses Profil gibt es nicht oder du siehst es nicht.',
    looks: { nacht: 'Nacht', arktis: 'Arktis', lachs: 'Lachs' },
  },

  avatar: {
    title: 'Profilbild', take: 'Foto aufnehmen', gallery: 'Aus Galerie wählen', remove: 'Bild entfernen',
    hint: 'Das Bild wird quadratisch zugeschnitten und klein gespeichert. Ohne Bild stehen die Initialen da.',
    forWhom: 'für {name}', change: 'Profilbild von {name} ändern', view: 'Profilbild von {name} groß ansehen', alt: 'Profilbild von {name}', saved: 'Profilbild gespeichert.', removed: 'Profilbild entfernt.',
    tooBig: 'Das Bild ließ sich nicht lesen.',
  },

  decks: {
    add: 'Commander hinzufügen', addFor: 'für {name}', search: 'Commander suchen', searchPh: 'Name eintippen, z. B. Atraxa',
    searchPartner: 'Partner suchen', noResults: 'Kein Commander gefunden.', searching: 'Sucht …', searchError: 'Scryfall ist gerade nicht erreichbar. Bitte versuch es gleich nochmal.',
    typeMore: 'Mindestens zwei Buchstaben eintippen.', change: 'Anderen wählen', partnerTag: 'Partner',
    addPartner: 'Partner hinzufügen', partnerHint: { partner: 'Hat „Partner“: du kannst einen zweiten Commander mit Partner dazunehmen.', with: 'Gehört zusammen mit {name}.', friends: 'Hat „Friends forever“.', background: 'Kann einen Hintergrund wählen.', doctor: 'Kann einen Companion des Doctors dazunehmen.', companion: 'Kann einen Doctor dazunehmen.' },
    removePartner: 'Partner entfernen', bracket: 'Bracket', bracketHint: 'Wie stark ist das Deck? 1 = Exhibition, 5 = cEDH.',
    link: 'Link zur Deckliste', linkPh: 'moxfield.com/decks/…', linkHint: 'Optional. Moxfield und Archidekt werden erkannt.', linkBad: 'Das sieht nicht nach einem Link aus.',
    save: 'Deck speichern', saved: 'Deck gespeichert.', none: 'Noch kein Deck.', noneOther: '{name} hat noch kein Deck.',
    games: 'Spiele', wins: 'Siege', winrate: 'Siegquote', place: 'Ø Platz', noGames: 'Noch keine Spiele', list: 'Deckliste',
    open: 'Öffnen', editLink: 'Link ändern', addLink: 'Link hinzufügen', noLink: 'Noch kein Link zur Deckliste.',
    changeBracket: 'Bracket ändern', remove: 'Deck entfernen', removed: 'Deck entfernt.', archived: 'Deck archiviert, weil es schon in Spielen vorkommt.',
    removeConfirm: 'Wirklich entfernen?', removeYes: 'Ja, entfernen', by: 'von {name}', notFound: 'Dieses Deck gibt es nicht oder du siehst es nicht.',
    art: 'Bild: {artist} · Scryfall',
  },

  settings: {
    account: 'Konto', accountSub: 'Passwort, E-Mail, Konto löschen', about: 'Über die App',
    legal: 'Rechtliches & Credits', legalSub: 'Fan-Content-Hinweis, Impressum, Lizenzen', privacy: 'Datenschutz', version: 'Version',
  },

  // Zugang (P9b): Einladung, Registrierung mit Code, Verwaltung
  access: {
    joinTitle: 'Einladung', enterTitle: 'Gruppe beitreten', enterSub: 'Gib den Code oder Link ein, den du von deiner Gruppe bekommen hast.',
    codeLabel: 'Code oder Link', next: 'Weiter',
    invited: 'Du wurdest in die Gruppe „{name}“ eingeladen', invitedNoName: 'Du wurdest in eine Gruppe eingeladen',
    invitedSub: 'Erstell ein Konto oder melde dich an, um beizutreten.',
    invalid: 'Diesen Link kennen wir nicht (mehr). Bitte frag in deiner Gruppe nach einem neuen.',
    full: 'Zurzeit sind alle Plätze vergeben.', fullSub: 'Hast du schon ein Konto, kannst du trotzdem beitreten.',
    adminTitle: 'Verwaltung', adminSub: 'Konten-Deckel, Gruppen erstellen',
    accountsTitle: 'Konten', accounts: '{n} von {max} Konten', unconfirmed: 'davon {n} noch nicht bestätigt',
    locked: 'Neue Registrierungen sind gesperrt.',
    capLabel: 'Höchstzahl an Konten', capHint: '1 bis 1000. Bestehende Konten bleiben bestehen.',
    capSave: 'Speichern', capSaved: 'Deckel gespeichert.',
    groupsTitle: 'Gruppen', createGroup: 'Gruppe erstellen', groupsHint: 'Einladungslinks findest du bei der jeweiligen Gruppe.',
    allGroups: 'Alle Gruppen', noAdmin: 'kein Admin', enter: 'Betreten', entered: 'Du bist jetzt in „{name}“.', allNone: 'Noch keine Gruppen.',
  },

  account: {
    title: 'Konto', signedInAs: 'Angemeldet als {email}',
    pwTitle: 'Passwort ändern', pwNew: 'Neues Passwort', pwRepeat: 'Neues Passwort wiederholen', pwSave: 'Passwort ändern',
    pwDone: 'Passwort geändert.', pwMismatch: 'Die beiden Passwörter stimmen nicht überein.', pwSame: 'Das neue Passwort muss sich vom alten unterscheiden.',
    emailTitle: 'E-Mail ändern', emailNew: 'Neue E-Mail-Adresse', emailSave: 'Bestätigungslinks schicken',
    emailHint: 'Wir schicken einen Bestätigungslink an deine alte und an die neue Adresse. Erst wenn du beide Links geöffnet hast, gilt die neue Adresse.',
    emailSent: 'Links sind unterwegs. Bitte bestätige in beiden Postfächern.',
    emailBad: 'Das sieht nicht nach einer E-Mail-Adresse aus.', emailSame: 'Das ist schon deine Adresse.',
    dangerTitle: 'Konto löschen', dangerSub: 'Endgültig. Lässt sich nicht rückgängig machen.', delete: 'Konto löschen',
    deleteTitle: 'Konto wirklich löschen?',
    deleteGone: 'Weg sind: dein Konto, dein Profil und Profilbild, deine Decks, die in keinem Spiel vorkommen.',
    deleteKept: 'Bleiben für deine Gruppen: gemeinsame Spiele und Statistiken. Dort stehst du dann als „Ehemaliges Mitglied“, gespielte Decks bleiben dort archiviert.',
    deleteSolo: 'Playgroups, in denen sonst niemand ein Konto hat, werden samt Spielen gelöscht. Bist du letzter Admin, wird das am längsten dabei befindliche Mitglied Admin.',
    deleteType: 'Tippe {word} ein, um zu bestätigen', deleteYes: 'Endgültig löschen', deleted: 'Dein Konto wurde gelöscht.',
  },

  legal: {
    title: 'Rechtliches & Credits', pending: 'Angaben folgen',
    fanTitle: 'Fan-Content',
    fan: 'Tracking the Gathering ist inoffizieller Fan-Content gemäß der Fan Content Policy. Nicht von Wizards of the Coast genehmigt oder unterstützt. Teile der verwendeten Materialien sind Eigentum von Wizards of the Coast. © Wizards of the Coast LLC.',
    fanLink: 'Fan Content Policy lesen',
    creditsTitle: 'Credits',
    scryfall: 'Kartendaten und Kartenbilder', icons: 'Icons', iconsLic: 'Phosphor Icons · MIT-Lizenz',
    fonts: 'Schriften', fontsLic: 'Bricolage Grotesque, Geist, Unbounded · SIL Open Font License 1.1 · selbst gehostet',
    imprintTitle: 'Impressum', privacyLink: 'Datenschutzerklärung', version: 'App-Version {v}',
  },

  privacy: {
    title: 'Datenschutz', updated: 'Stand: November 2026',
    intro: 'Hier steht, welche Daten Tracking the Gathering verarbeitet, wo sie liegen und welche Rechte du hast.',
    controllerTitle: 'Verantwortlich',
    sections: [
      { h: 'Was gespeichert wird', p: [
        'Konto: E-Mail-Adresse, Passwort (nur als Hash, nicht im Klartext), Anzeigename, Sprache, Erscheinungsbild und optional ein Profilbild.',
        'Gruppendaten: Playgroups, Mitglieder (auch Spieler ohne Konto), Decks, Spiele, Spielereignisse und Bewertungen. Diese Daten sehen nur Mitglieder derselben Playgroup.',
        'Zweck ist allein der Betrieb der App für dich und deine Gruppe (Art. 6 Abs. 1 lit. b DSGVO).'] },
      { h: 'Supabase (Server in Frankfurt, EU)', p: [
        'Anmeldung, Datenbank und Bildspeicher laufen bei Supabase in der Region Frankfurt am Main (EU). Supabase verarbeitet die Daten in unserem Auftrag.'] },
      { h: 'E-Mail-Versand: Brevo (EU)', p: [
        'Wenn du ein neues Passwort anforderst, verschickt Supabase die Mail mit dem Link über den Mail-Dienst Brevo (Sendinblue SAS, Paris, Frankreich). Brevo erhält dafür deine E-Mail-Adresse und den Inhalt dieser Mail und verarbeitet sie in unserem Auftrag. Andere Mails, etwa Werbung, verschickt die App nicht.'] },
      { h: 'Commander Spellbook (Bracket-Prüfung)', p: [
        'Wenn du für ein Deck die Bracket-Prüfung startest, schickt unser Server bei Supabase die Kartenliste des Decks an Commander Spellbook (commanderspellbook.com), um Kombos und Game Changer zu finden. Dabei gehen nur Kartennamen hinaus, keine Konto-, Gruppen- oder Gerätedaten und nicht deine IP-Adresse.'] },
      { h: 'Scryfall (USA)', p: [
        'Kartenbilder und die Commander-Suche kommen direkt von Scryfall (scryfall.com). Dabei überträgt dein Gerät deine IP-Adresse und den Suchbegriff an Scryfall in den USA. Konto- oder Gruppendaten gehen nicht an Scryfall.'] },
      { h: 'GitHub Pages und esm.sh (Auslieferung der App)', p: [
        'Die App-Dateien liegen bei GitHub Pages (GitHub Inc., USA). Beim Aufruf verarbeitet GitHub technisch nötige Daten wie IP-Adresse und Zeitpunkt.',
        'Die Programmbibliothek für die Anmeldung (supabase-js) lädt die App beim Start von esm.sh; auch dabei wird deine IP-Adresse übertragen.',
        'Schriften liegen in der App selbst, es gibt keine Anfrage an Google Fonts.'] },
      { h: 'Keine Tracker', p: [
        'Keine Analyse, keine Werbung, keine Cookies von Dritten. Im Browser speichert die App nur, was sie zum Funktionieren braucht: deine Anmeldung, Sprache, Look, die gewählte Playgroup, noch nicht gesendete Spielereignisse und die App-Dateien für den Offline-Betrieb.'] },
      { h: 'Speicherdauer und Löschen', p: [
        'Daten bleiben, solange dein Konto besteht. Unter Einstellungen → Konto kannst du dein Konto jederzeit selbst löschen. Dann sind Konto, Profil, Profilbild und ungespielte Decks weg. Gemeinsame Spiele bleiben für die Gruppe erhalten, du erscheinst dort als „Ehemaliges Mitglied“ ohne Namen und Bild; gespielte Decks bleiben dort archiviert. Playgroups, in denen sonst niemand ein Konto hat, werden samt Spielen und Fotos gelöscht.'] },
      { h: 'Deine Rechte', p: [
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren. Für Anfragen wende dich an den oben genannten Verantwortlichen.'] },
    ],
  },

  common: { back: 'Zurück', close: 'Schließen', cancel: 'Abbrechen', loading: 'Lädt …', error: 'Da ist etwas schiefgelaufen.', reload: 'Neu laden',
    stale: 'Nicht aktualisiert – Stand von {time} Uhr' }, // P12

  setup, life, dice, attack, ko, intro, // intro: P3 Spielstart-Intro
  decklist, live, table, // Naht P3 (Welle ttg-live-feinschliff-decks)
};

// Namensräume Etappe 4/5 (Naht P13): je Paket eine eigene Datei, oben im Objekt nach `soon` eingebunden (Imports sind gehoben).
import result from './de-result.js';
import history from './de-history.js';
import board from './de-board.js';
import recap from './de-recap.js';
import stats from './de-stats.js';
