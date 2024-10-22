const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;

// Middleware voor body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Stel de views directory en view engine in
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware voor statische bestanden (CSS, afbeeldingen, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Sessieconfiguratie
app.use(session({
    secret: 'jouw_geheime_sleutel',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: app.get('env') === 'production', maxAge: 60 * 60 * 1000 } // 1 uur geldig
}));

// MySQL-configuratie
const db = mysql.createPool({
    host: 'localhost',
    user: 'admin',      // Vervang door jouw MySQL-gebruikersnaam
    password: 'password',  // Vervang door jouw MySQL-wachtwoord
    database: 'kktoe' // Vervang door jouw MySQL-database naam
});

// Verbinding maken met de database
async function connectToDatabase() {
    try {
        const connection = await db.getConnection();
        console.log('Verbonden met de MySQL database als ID ' + connection.threadId);
        connection.release();
    } catch (err) {
        console.error('Fout bij het verbinden met de database:', err.stack);
        setTimeout(connectToDatabase, 5000); // Probeer na 5 seconden opnieuw te verbinden
    }
}

connectToDatabase();

// Middelware voor rolcontrole
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
            return res.status(403).send('Toegang geweigerd. Onvoldoende rechten.');
        }
        next();
    };
}

// Route voor de hoofdpagina (omleiden naar inlogpagina)
app.get('/', (req, res) => {
    res.redirect('/login');
});

// Route voor de inlogpagina
app.get('/login', (req, res) => {
    res.render('login', { errorMessage: req.session.errorMessage });
    req.session.errorMessage = null;
});

// Route voor inloggen
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log('Inlogpoging met e-mail:', email);

    // Haal de gebruiker op met de bijbehorende rol uit de database
    const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (results.length > 0) {
        const user = results[0];
        console.log('Gebruiker gevonden:', user.id);

        // Vergelijk het ingevoerde wachtwoord met het gehashte wachtwoord in de database
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            console.log('Inloggen succesvol voor gebruiker:', user.id);
            req.session.user = {
                id: user.id,
                email: user.email,
                role: user.role // Voeg de rol toe aan de sessie
            };
            return res.redirect('/dashboard');
        } else {
            console.log('Wachtwoord komt niet overeen voor gebruiker:', user.id);
        }
    } else {
        console.log('Geen gebruiker gevonden met e-mail:', email);
    }

    req.session.errorMessage = 'Ongeldige inloggegevens, probeer het opnieuw.';
    return res.redirect('/login');
});

// Route voor registratiepagina
app.get('/register', (req, res) => {
    res.render('register');
});

// Route voor registreren
app.post('/register', async (req, res) => {
    const { email, password, role } = req.body;

    // Controleer of het e-mailadres al bestaat
    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
        return res.status(400).send('E-mail is al in gebruik.');
    }

    // Hash het wachtwoord
    const hashedPassword = await bcrypt.hash(password, 10);

    // SQL-query om de gebruiker toe te voegen aan de database
    await db.query('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', 
        [email, hashedPassword, role]);

    // Redirect of stuur een succesbericht
    res.redirect('/login');
});

// Route voor het admin dashboard
app.get('/admin-dashboard', checkRole(['administrator']), (req, res) => {
    res.render('admin-dashboard', { title: 'Admin Dashboard' });
});

// Route voor Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Controleer of de gebruiker ingelogd is
    }
    res.render('dashboard', { title: 'Welkom bij Mijn KKTOE Dashboard', user: req.session.user });
});

// Route voor Intekenen op diensten
app.get('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const userRole = req.session.user.role;

    // Halen diensten op voor de respectieve rol
    const [results] = await db.query('SELECT * FROM diensten WHERE afdeling = ?', [userRole]);
    
    res.render('intekenen', { title: 'Intekenpagina', diensten: results });
});

// Route voor het verwerken van de inschrijving (POST-verzoek)
app.post('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const geselecteerdeDiensten = req.body.dienst; // Verkrijg de geselecteerde diensten uit het formulier
    const userId = req.session.user.id;

    if (!geselecteerdeDiensten) {
        return res.status(400).send('Selecteer ten minste één dienst.');
    }

    // Controleer of er meerdere diensten zijn geselecteerd
    const geselecteerdeDienstenArray = Array.isArray(geselecteerdeDiensten) ? geselecteerdeDiensten : [geselecteerdeDiensten];

    for (const dienstId of geselecteerdeDienstenArray) {
        // Voeg logging toe om te controleren welke diensten worden ingeschreven
        console.log(`Gebruiker ${userId} schrijft zich in voor dienst ${dienstId}`);

        // Sla de inschrijving op in de database
        await db.query('INSERT INTO inschrijvingen (user_id, dienst_id) VALUES (?, ?)', [userId, dienstId]);
    }

    res.send('Je inschrijving is succesvol verwerkt.');
});

// Route voor het bekijken van inschrijvingen
app.get('/inschrijvingen', checkRole(['administrator']), async (req, res) => {
    const [results] = await db.query('SELECT i.*, u.email, d.activiteit FROM inschrijvingen i JOIN users u ON i.user_id = u.id JOIN diensten d ON i.dienst_id = d.id');
    res.render('inschrijvingen', { title: 'Inschrijvingen', inschrijvingen: results });
});

// Route voor het verwijderen van inschrijvingen
app.post('/inschrijvingen-verwijderen', async (req, res) => {
    const inschrijvingId = req.body.inschrijving_id;

    // Voorbeeld van databaseverwijdering (pas aan op basis van jouw database)
    try {
        const [result] = await db.query('DELETE FROM inschrijvingen WHERE id = ?', [inschrijvingId]);
        if (result.affectedRows > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, error: 'Geen inschrijving gevonden met dat ID.' });
        }
    } catch (error) {
        console.error('Fout bij het verwijderen:', error);
        return res.status(500).json({ success: false, error: 'Er is een fout opgetreden bij het verwijderen van de inschrijving.' });
    }
});

// Route voor het beheren van gebruikers
app.get('/gebruikers', checkRole(['administrator']), async (req, res) => {
    const [results] = await db.query('SELECT * FROM users');
    res.render('gebruikers', { title: 'Gebruikersbeheer', gebruikers: results });
});

// Route voor het aanmaken van gebruikers via de gebruikers-beheer pagina
app.get('/gebruiker-aanmaken', (req, res) => {
    res.render('gebruiker-aanmaken', { title: 'Nieuwe Gebruiker Aanmaken' });
});

// Route voor het aanmaken van een gebruiker
app.post('/gebruiker-aanmaken', async (req, res) => {
    const { email, role, naam, telefoonnummer, klas, coach, password } = req.body;

    try {
        // Voeg validatie toe voor verplichte velden
        if (!email || !role || !naam) {
            return res.status(400).send('E-mail, rol en naam zijn verplicht.');
        }

        // Controleer of het wachtwoord aanwezig is
        if (!password) {
            return res.status(400).send('Wachtwoord is verplicht.');
        }

        // Controleer of het e-mailadres al bestaat
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).send('E-mail is al in gebruik.');
        }

        // Hash het wachtwoord
        const hashedPassword = await bcrypt.hash(password, 10);

        // Voeg de nieuwe gebruiker toe aan de database
        await db.query('INSERT INTO users (email, password, role, naam, telefoonnummer, klas, coach) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [email, hashedPassword, role, naam, telefoonnummer, klas, coach]);

        res.redirect('/gebruikers');
    } catch (error) {
        console.error('Fout bij het aanmaken van gebruiker:', error);
        res.status(500).send('Er is een fout opgetreden bij het aanmaken van de gebruiker.');
    }
});

// Route voor het verwijderen van gebruikers
app.post('/gebruiker-verwijderen', async (req, res) => {
    const { gebruiker_id } = req.body; // Verkrijg de ID van de gebruiker

    // Log de ontvangen gebruiker ID
    console.log('Verzoek ontvangen om gebruiker te verwijderen met ID:', gebruiker_id);

    // Controleer of gebruiker_id is opgegeven
    if (!gebruiker_id) {
        console.log('Geen gebruiker ID opgegeven in het verzoek.');
        return res.status(400).json({ success: false, error: 'Geen gebruiker ID opgegeven.' });
    }

    try {
        // Wijzig de SQL-query naar de juiste tabelnaam
        const [results] = await db.query('DELETE FROM users WHERE id = ?', [gebruiker_id]);

        // Log het resultaat van de verwijdering
        console.log('Resultaat van de verwijdering:', results);

        // Controleer of de gebruiker is verwijderd
        if (results.affectedRows > 0) {
            console.log('Gebruiker succesvol verwijderd met ID:', gebruiker_id);
            return res.json({ success: true });
        } else {
            console.log('Geen gebruiker gevonden met ID:', gebruiker_id);
            return res.json({ success: false, error: 'Geen gebruiker gevonden met dat ID.' });
        }
    } catch (error) {
        // Log de fout
        console.error('Fout bij het verwijderen:', error);
        return res.status(500).json({ success: false, error: 'Er is een fout opgetreden bij het verwijderen van de gebruiker.' });
    }
});

// Route voor uitloggen
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Fout bij uitloggen:', err);
            return res.status(500).send('Er is een fout opgetreden bij het uitloggen.');
        }
        res.redirect('/login');
    });
});

// Globale foutafhandelingsmiddleware
app.use((err, req, res, next) => {
    console.error('Er is een fout opgetreden:', err.stack);
    res.status(500).send('Er is een interne serverfout opgetreden.');
});

// Server starten
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});
