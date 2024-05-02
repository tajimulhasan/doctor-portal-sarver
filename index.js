const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");

require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

//mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s3xiulm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("Doctor portal is smoothly running");
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("docor_portal_data")
      .collection("services");

    const appointmentCollection = client
      .db("docor_portal_data")
      .collection("booking_appointment");

    const userCollection = client.db("docor_portal_data").collection("users");

    app.get("/services", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
      const services = await cursor.toArray();
      res.send(services);
    });

    //Warning:
    // This is not the proper way to query;
    //After learning more about mongodb. use aggregate lookup, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      //1. get all services
      const services = await serviceCollection.find().toArray();

      //2. get the booking of that day
      const query = { date: date };
      const bookedAppointment = await appointmentCollection
        .find(query)
        .toArray();

      //step-3; for Each service
      services.forEach((service) => {
        //step-4: find bookings for that service
        const serviceBookings = bookedAppointment.filter(
          (book) => book.treatmentName === service.name
        );
        //5: select slots for the service bookings
        const bookedSlots = serviceBookings.map((b) => b.schedule);
        //6
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });
      res.send(services);
    });

    app.get("/user", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get("/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    //update user
    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requester = req.decoded.email;
      const requestterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requestterAccount.role === 'admin') {
        const filter = { email: email };

        const updateDoc = {
          $set: { role: 'admin' },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send( result );
      }
      
      else {
        res.status(403).send({ message: "forbidden" });
      }
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email === decodedEmail) {
        const query = { email: email };
        const cursor = appointmentCollection.find(query);
        const booked = await cursor.toArray();
        res.send(booked);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    //POST
    app.post("/bookings", async (req, res) => {
      const newBooking = req.body;
      const query = {
        treatmentName: newBooking.treatmentName,
        date: newBooking.date,
        patientName: newBooking.patientName,
      };
      const IsExists = await appointmentCollection.findOne(query);
      if (IsExists) {
        return res.send({ success: false, newBooking: IsExists });
      }
      const result = await appointmentCollection.insertOne(newBooking);
      return res.send({ success: true, result });
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Doctor Portal listening on port ${port}`);
});
