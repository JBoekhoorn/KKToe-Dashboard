const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise'); // Gebruik mysql2 met promises
const session = require('express-session');
const bcrypt = require('bcrypt');
const router = express.Router();
const flash = require('connect-flash');


const app = express();
const PORT = 3000;

// Gebruik body-parser middleware voor het verwerken van JSON en URL-encoded requests
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
    cookie: { secure: false } // Zet dit op true als je HTTPS gebruikt
}));

// MySQL-configuratie
const db = mysql.createPool({
    host: 'localhost',
    user: 'admin',      // Vervang door jouw MySQL-gebruikersnaam
    password: 'password',  // Vervang door jouw MySQL-wachtwoord
    database: 'kktoe' // Vervang door jouw MySQL-database naam
});

// Verbinding maken met de database
db.getConnection()
    .then(conn => {
        console.log('Verbonden met de MySQL database');
        conn.release(); // Sluit de verbinding na controle
    })
    .catch(err => {
        console.error('Fout bij het verbinden met de database: ', err.stack);
    });

// Middelware voor rolcontrole
function checkRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
            return res.status(403).json({ message: 'Toegang geweigerd. Onvoldoende rechten.' });
        }
        next();
    };
}

// Middleware voor flash-meldingen
app.use(flash());

// Functie om tijd te formatteren in HH:MM
function formatTime(timeString) {
    if (timeString) {
        const timeParts = timeString.split(':');
        const hours = timeParts[0].padStart(2, '0');
        const minutes = timeParts[1].padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    return '00:00'; // Standaard als tijd ontbreekt
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

    try {
        const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (results.length > 0) {
            const user = results[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.user = {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    naam: user.naam // Voeg hier de naam van de gebruiker toe
                };
                return res.redirect('/dashboard');
            }
        }

        req.session.errorMessage = 'Ongeldige inloggegevens, probeer het opnieuw.';
        return res.redirect('/login');
    } catch (err) {
        console.error(err);
        return res.redirect('/login');
    }
});

// Route voor Dashboard
app.get('/dashboard', (req, res) => {
    // Controleer of de gebruiker ingelogd is
    if (!req.session.user) {
        return res.redirect('/login'); // Omleiden naar de inlogpagina als niet ingelogd
    }

    // Render de dashboard pagina met de titel en de ingelogde gebruiker
    res.render('dashboard', {
        title: 'Welkom bij Mijn KKTOE Dashboard',
        user: req.session.user // Doorgeven van de ingelogde gebruiker
    });
});

// Route voor het admin dashboard
app.get('/admin-dashboard', async (req, res, next) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }
    // Ga door naar de volgende middleware voor rolcontrole
    next();
}, checkRole(['administrator']), (req, res) => {
    res.render('admin-dashboard', { title: 'Admin Dashboard' });
});

// Route voor Intekenen op diensten
app.get('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const userRole = req.session.user.role;

    try {
        const [results] = await db.query('SELECT * FROM diensten WHERE afdeling = ?', [userRole]);
        res.render('intekenen', { title: 'Intekenpagina', diensten: results });
    } catch (err) {
        console.error('Fout bij het ophalen van diensten: ', err);
        res.status(500).json({ message: 'Fout bij het ophalen van diensten.' });
    }
});

// Route voor het verwerken van de inschrijving (POST-verzoek)
app.post('/intekenen', checkRole(['techniek', 'kktoe', 'administrator']), async (req, res) => {
    const geselecteerdeDiensten = req.body.dienst;
    const userId = req.session.user.id;

    if (!geselecteerdeDiensten) {
        return res.status(400).json({ message: 'Selecteer ten minste één dienst.' });
    }

    const geselecteerdeDienstenArray = Array.isArray(geselecteerdeDiensten) ? geselecteerdeDiensten : [geselecteerdeDiensten];

    try {
        for (const dienstId of geselecteerdeDienstenArray) {
            await db.query('INSERT INTO diensten (user_id, dienst_id) VALUES (?, ?)', [userId, dienstId]);
        }

        res.json({ message: 'Je inschrijving is succesvol verwerkt.' });
    } catch (err) {
        console.error('Fout bij het inschrijven: ', err);
        res.status(500).json({ message: 'Fout bij het verwerken van de inschrijving.' });
    }
});

// Route voor het bekijken van openstaande diensten
app.get('/openstaande-diensten', async (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const user = req.session.user; // Haal de ingelogde gebruiker op

        // Haal alle openstaande diensten op (waar de user_id NULL is)
        const [results] = await db.query('SELECT * FROM diensten WHERE user_id IS NULL');

        // Format de tijden voor elke dienst
        const formattedResults = results.map(dienst => ({
            ...dienst,
            aanvang: formatTime(dienst.aanvang),
            einde: formatTime(dienst.einde)
        }));

        // Filter de resultaten op basis van de rol van de gebruiker (alleen KKTOE-diensten voor de rol 'kktoe')
        let filteredResults = formattedResults;
        if (user.role === 'kktoe') {
            filteredResults = formattedResults.filter(dienst => 
                dienst.soort_dienst === 'KKToe - Algemeen' || dienst.soort_dienst === 'KKToe - Horeca'
            );
        }

        if (filteredResults.length === 0) {
            return res.render('openstaande-diensten', { diensten: [], message: 'Geen openstaande diensten gevonden.' });
        }

        // Render de pagina met gefilterde resultaten
        res.render('openstaande-diensten', { diensten: filteredResults, message: '' });
    } catch (error) {
        console.error('Fout bij het ophalen van diensten:', error);
        res.status(500).json({ message: 'Fout bij het ophalen van diensten.' });
    }
});

// Route voor het opslaan van ingetekende diensten
app.post('/diensten/inschrijven', async (req, res) => {
    const geselecteerdeDienstIds = req.body.dienst_ids;
    const userId = req.session.user.id;

    if (!geselecteerdeDienstIds || geselecteerdeDienstIds.length === 0) {
        return res.status(400).json({ message: 'Geen diensten geselecteerd.' });
    }

    const query = `UPDATE diensten SET user_id = ? WHERE id IN (${geselecteerdeDienstIds.map(() => '?').join(',')})`;

    try {
        await db.query(query, [userId, ...geselecteerdeDienstIds]);
        res.json({ message: 'Diensten succesvol opgeslagen.' });
    } catch (err) {
        console.error('Fout bij het updaten van de diensten:', err);
        res.status(500).json({ message: 'Er is iets fout gegaan.' });
    }
});

// Route om de gegevens voor de account pagina op te halen uit de tabel
router.get('/account', async (req, res) => {
    const userId = req.session.userId; // Aannemende dat de gebruikers-ID in de sessie is opgeslagen
    const user = await User.findById(userId);
    res.render('account', { user });
});

// POST route om gegevens bij te werken
router.post('/update-gegevens', async (req, res) => {
    const { username, klas, coach, email, telefoonnummer, password } = req.body;
    const userId = req.session.userId;

    const updatedData = {
        username,
        klas,
        coach,
        email,
        telefoonnummer
    };

    if (password) {
        // Hash het nieuwe wachtwoord voordat je het opslaat
        const hashedPassword = await bcrypt.hash(password, 10);
        updatedData.password = hashedPassword;
    }

    await User.findByIdAndUpdate(userId, updatedData);
    
    // Stel een flash-melding in
    req.flash('success', 'Je gegevens zijn succesvol opgeslagen.');

    // Redirect naar de account pagina
    res.redirect('/account');
});

module.exports = router;

app.use((req, res, next) => {
    res.locals.messages = req.flash('success');
    next();
});

// Route voor het aanmaken van een nieuwe dienst
app.post('/diensten-aanmaken', async (req, res) => {
    const { datum, activiteit, soort_dienst, aanvang, einde } = req.body;

    try {
        await db.query('INSERT INTO diensten (datum, activiteit, soort_dienst, aanvang, einde) VALUES (?, ?, ?, ?, ?)', 
            [datum, activiteit, soort_dienst, aanvang, einde]);
        res.redirect('/diensten-beheren');
    } catch (err) {
        console.error('Fout bij het toevoegen van de dienst: ', err);
        res.status(500).json({ message: 'Er is een fout opgetreden bij het aanmaken van de dienst.' });
    }
});

// Route voor het bekijken van de diensten van de ingelogde gebruiker
app.get('/mijn-diensten', (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login'); // Als de gebruiker niet is ingelogd, stuur hem naar de inlogpagina
    }

    const userId = req.session.user.id;

    db.query('SELECT * FROM diensten WHERE user_id = ?', [userId])
        .then(([results]) => {
            // Format de tijden voor elke dienst
            const formattedResults = results.map(dienst => ({
                ...dienst,
                aanvang: formatTime(dienst.aanvang),
                einde: formatTime(dienst.einde)
            }));

            res.render('mijn-diensten', {
                diensten: formattedResults,
                message: formattedResults.length === 0 ? 'Je hebt geen diensten ingetekend.' : ''
            });
        })
        .catch(error => {
            console.error('Fout bij het ophalen van de diensten:', error);
            res.status(500).json({ message: 'Fout bij het ophalen van de diensten.' });
        });
});

// Route om de dienst te verwijderen van een gebruiker (user_id op NULL zetten)
app.post('/diensten/verwijderen/:id', (req, res) => {
    const dienstId = req.params.id;

    const sql = 'UPDATE diensten SET user_id = NULL WHERE id = ?';

    db.query(sql, [dienstId], (err, result) => {
        if (err) {
            console.error('Fout bij het verwijderen van de dienst:', err);
            return res.status(500).json({ message: 'Er is een fout opgetreden bij het verwijderen van de dienst.' });
        }

        res.status(200).json({ message: 'Dienst succesvol verwijderd.' });
    });
});

// Route voor het bekijken van gebruikers
app.get('/gebruikers', async (req, res, next) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }
    // Ga door naar de volgende middleware voor rolcontrole
    next();
}, checkRole(['administrator']), async (req, res) => {
    try {
        const [users] = await db.query('SELECT * FROM users');
        res.render('gebruikers', { users });
    } catch (err) {
        console.error('Fout bij het ophalen van gebruikers: ', err);
        res.status(500).json({ message: 'Er is een fout opgetreden bij het ophalen van gebruikers.' });
    }
});

// Route voor het beheren van diensten
app.get('/diensten-beheren', checkRole(['administrator']), async (req, res) => {
    try {
        const [diensten] = await db.query('SELECT * FROM diensten');
        
        // Format de tijden voor elke dienst
        const formattedDiensten = diensten.map(dienst => ({
            ...dienst,
            aanvang: formatTime(dienst.aanvang),
            einde: formatTime(dienst.einde)
        }));

        res.render('diensten-beheren', { diensten: formattedDiensten, title: 'Diensten Beheren' });
    } catch (error) {
        console.error('Fout bij het ophalen van de diensten voor beheer:', error);
        res.status(500).json({ message: 'Fout bij het ophalen van diensten.' });
    }
});

// Route voor het bekijken van persoonlijke gegevens
app.get('/account', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Gebruiker moet ingelogd zijn
    }

    const userId = req.session.user.id;

    db.query('SELECT * FROM users WHERE id = ?', [userId])
        .then(([result]) => {
            if (result.length > 0) {
                res.render('account', { user: result[0], title: 'account' });
            } else {
                res.status(404).json({ message: 'Gebruiker niet gevonden.' });
            }
        })
        .catch(error => {
            console.error('Fout bij het ophalen van gebruikersgegevens:', error);
            res.status(500).json({ message: 'Fout bij het ophalen van gebruikersgegevens.' });
        });
});

// Route voor het bijwerken van gebruikersgegevens
app.post('/account', async (req, res) => {
    const userId = req.session.user.id; // Verkrijg het gebruikers-ID uit de sessie
    const { email, wachtwoord, klas, teacher, phone } = req.body;

    // Log de ontvangen gegevens voor debugging
    console.log('Ontvangen formuliergegevens:', req.body);

    try {
        // Haal de huidige gegevens van de gebruiker op (inclusief het wachtwoord)
        const userQuery = 'SELECT password FROM users WHERE id = ?';  // Gebruik 'password' in plaats van 'wachtwoord'
        const userResult = await db.query(userQuery, [userId]);
        const currentPassword = userResult[0]?.password;  // Verkrijg het huidige wachtwoord
        console.log('Huidig wachtwoord uit de database:', currentPassword);

        // Start met de basisupdatequery zonder het wachtwoord
        let updateQuery = 'UPDATE users SET email = ?, klas = ?, coach = ?, telefoonnummer = ? WHERE id = ?';
        let queryParams = [email, klas, teacher, phone, userId];

        // Als er een nieuw wachtwoord is ingevuld, moet dit worden gehashed en toegevoegd aan de query
        if (wachtwoord) {
            console.log('Nieuw wachtwoord ingevoerd:', wachtwoord);

            // Vergelijk het huidige wachtwoord met het ingevoerde wachtwoord
            const isMatch = await bcrypt.compare(wachtwoord, currentPassword);
            if (isMatch) {
                console.log('Het ingevoerde wachtwoord is hetzelfde als het huidige wachtwoord. Geen wijziging.');
                return res.redirect('/account');  // Geen update uitvoeren als het wachtwoord niet veranderd is
            }

            // Hash het wachtwoord
            const hashedPassword = await bcrypt.hash(wachtwoord, 10);
            console.log('Gehashed wachtwoord:', hashedPassword); // Log het gehashte wachtwoord voor debugging

            // Voeg het gehashte wachtwoord toe aan de updatequery
            updateQuery = 'UPDATE users SET email = ?, klas = ?, coach = ?, telefoonnummer = ?, password = ? WHERE id = ?';  // Gebruik 'password' in plaats van 'wachtwoord'
            queryParams = [email, klas, teacher, phone, hashedPassword, userId];

            console.log('Update query voor wachtwoord:', updateQuery);
            console.log('Query parameters voor wachtwoord:', queryParams);
        }

        // Voer de update query uit
        const result = await db.query(updateQuery, queryParams); // Gebruik await om ervoor te zorgen dat de query wordt uitgevoerd

        console.log('Query uitvoer:', result);  // Log de uitvoer van de query

        if (result && result.affectedRows > 0) {
            console.log('Gebruikersgegevens succesvol bijgewerkt.');
        } else {
            console.log('Geen wijziging aangebracht in de gebruikersgegevens.');
        }

        res.redirect('/account');
    } catch (err) {
        console.error('Fout bij het updaten van gebruikersgegevens:', err);
        res.status(500).json({ message: 'Er is iets misgegaan bij het updaten van de gegevens.' });
    }
});

// Route voor het bekijken van inschrijvingen van de gebruiker
app.get('/inschrijvingen', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userId = req.session.user.id;

    db.query('SELECT * FROM diensten WHERE user_id = ?', [userId])
        .then(([diensten]) => {
            const formattedDiensten = diensten.map(dienst => ({
                ...dienst,
                aanvang: formatTime(dienst.aanvang),
                einde: formatTime(dienst.einde)
            }));

            res.render('inschrijvingen', {
                diensten: formattedDiensten,
                title: 'Mijn Inschrijvingen',
                message: formattedDiensten.length === 0 ? 'Je hebt je nog niet ingeschreven voor diensten.' : ''
            });
        })
        .catch(error => {
            console.error('Fout bij het ophalen van ingeschreven diensten:', error);
            res.status(500).json({ message: 'Fout bij het ophalen van ingeschreven diensten.' });
        });
});

// Route voor het bekijken van alle ingeschreven diensten
app.get('/ingeschreven-diensten', async (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const sql = `
            SELECT diensten.id, diensten.datum, diensten.activiteit, diensten.soort_dienst, 
                   diensten.aanvang, diensten.einde, users.naam 
            FROM diensten 
            JOIN users ON diensten.user_id = users.id
            WHERE diensten.user_id IS NOT NULL
            ORDER BY diensten.datum ASC
        `;

        const [results] = await db.query(sql);
        res.render('ingeschreven-diensten', { diensten: results });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

// Route om inschrijvingen te beheren
app.get('/inschrijvingen-beheren', async (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        // SQL-query om alle inschrijvingen op te halen
        const [results] = await db.query('SELECT id, datum, activiteit, soort_dienst, aanvang, einde FROM diensten');

        // Render de EJS-pagina en stuur de inschrijvingen mee
        res.render('inschrijvingen-beheren', { inschrijvingen: results });
    } catch (err) {
        console.error('Fout bij ophalen van inschrijvingen:', err);
        res.status(500).send('Fout bij ophalen van inschrijvingen');
    }
});

// Route om een nieuwe inschrijving toe te voegen
app.post('/inschrijving-toevoegen', (req, res) => {
    const { datum, activiteit, soort_dienst, aanvang, einde, notities } = req.body;

    // Voeg de inschrijving toe aan de database in de 'diensten' tabel
    db.query('INSERT INTO diensten (datum, activiteit, soort_dienst, aanvang, einde, notities) VALUES (?, ?, ?, ?, ?, ?)', 
    [datum, activiteit, soort_dienst, aanvang, einde, notities], 
    (error, results) => {
        if (error) {
            console.error('Fout bij het toevoegen van inschrijving:', error); // Log the error for debugging
            return res.status(500).send('Fout bij het toevoegen van inschrijving.');
        }
        res.redirect('/inschrijving-beheren'); // Redirect na toevoeging
    });
});

// Route om een inschrijving te verwijderen
app.post('/inschrijvingen-verwijderen', async (req, res) => {
    const { inschrijving_id } = req.body;

    try {
        // Verwijder de inschrijving uit de 'diensten' tabel
        const sql = 'DELETE FROM diensten WHERE id = ?';
        const [result] = await db.query(sql, [inschrijving_id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Inschrijving niet gevonden' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Fout bij verwijderen van inschrijving:', err);
        res.status(500).json({ success: false, error: 'Fout bij verwijderen van inschrijving' });
    }
});

// Route voor het bekijken van het volledige rooster
app.get('/rooster', async (req, res) => {
    // Controleer of de gebruiker is ingelogd
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        // Verbind met de database en haal diensten op
        const result = await db.query('SELECT id, user_id, datum, activiteit, soort_dienst, aanvang, einde FROM diensten');

        // Neem alleen de eerste array met rijen
        const diensten = result[0];

        // Controleer of er resultaten zijn
        if (!diensten || diensten.length === 0) {
            throw new Error("Geen rijen gevonden in het resultaat.");
        }

        // Format de tijden voor elke dienst
        const formattedDiensten = diensten.map(dienst => ({
            ...dienst,
            aanvang: formatTime(dienst.aanvang),
            einde: formatTime(dienst.einde)
        }));

        // Verstuur de opgehaalde en geformatteerde data naar je EJS template
        res.render('rooster', { diensten: formattedDiensten, title: 'Volledig Rooster' });
    } catch (error) {
        console.error('Fout bij het ophalen van het rooster:', error);
        res.status(500).json({ message: 'Fout bij het ophalen van het rooster.' });
    }
});

// Server route voor het toevoegen van een nieuwe gebruiker
app.post('/gebruiker-toevoegen', async (req, res) => {
    const { email, naam, telefoonnummer, klas, role, coach, password } = req.body;

    // Validatie van invoer
    if (!email || !naam || !role || !password) {
        return res.status(400).json({ success: false, message: 'Vul alle verplichte velden in.' });
    }

    try {
        // Controleer of het emailadres al in gebruik is
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'Emailadres is al in gebruik.' });
        }

        // Hash het wachtwoord
        const hashedPassword = await bcrypt.hash(password, 10);

        // Voeg de gebruiker toe aan de database
        await db.query('INSERT INTO users (email, naam, telefoonnummer, klas, role, coach, password) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [email, naam, telefoonnummer, klas, role, coach, hashedPassword]);

        // Stuur een succesbericht terug
        res.status(201).json({ success: true, message: 'Gebruiker succesvol toegevoegd.' });
    } catch (err) {
        console.error('Fout bij het toevoegen van gebruiker:', err);
        res.status(500).json({ success: false, message: 'Er is een fout opgetreden bij het toevoegen van de gebruiker.' });
    }
});

// Route om een gebruiker te verwijderen
router.delete('/gebruiker-verwijderen/:id', (req, res) => {
    const gebruikerId = req.params.id;
    console.log(`Verwijdering aangevraagd voor gebruiker met id: ${gebruikerId}`);

    // Verwijder gebruiker uit de tabel 'users'
    const query = 'DELETE FROM users WHERE id = ?';

    db.query(query, [gebruikerId], (err, results) => {
        if (err) {
            console.error('Fout bij verwijderen gebruiker:', err);
            return res.status(500).send('Er is een fout opgetreden bij het verwijderen van de gebruiker.');
        }

        console.log(`Aantal verwijderde rijen: ${results.affectedRows}`);
        if (results.affectedRows > 0) {
            res.status(200).send('Gebruiker succesvol verwijderd');
        } else {
            res.status(404).send('Gebruiker niet gevonden');
        }
    });
});

// Luister op de opgegeven poort
app.listen(PORT, () => {
    console.log(`Server draait op http://localhost:${PORT}`);
});
