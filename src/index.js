const { ApolloServer, gql } = require('apollo-server');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
dotenv.config();


const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

  
const getToken = (user) => jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30 days' }) 


const getUserFromToken = async (token, db) => {
  if (!token) {return null}

  const tokenData = jwt.verify(token, JWT_SECRET);
  if (!tokenData?.id) {
    return null;
  }

  user = await db.collection('Users').findOne( { _id: ObjectId(tokenData.id)} );
  return user;
}

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = gql`

  type Query {
    myTaskLists: [TaskList!]!
    getTaskList(id:ID!): TaskList

  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    signIn(input: SignInInput!): AuthUser!

    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList
    deleteTaskList(id: ID!): Boolean!
    addUserToTaskList(taskListId: ID!, userId: ID!): TaskList

    createToDo(content: String!, taskListId: ID!): ToDo!
    updateToDo(id: ID!, content: String, isCompleted: Boolean!): ToDo!
    deleteToDo(id: ID!): Boolean!
  }

  input SignInInput {
    email: String!
    password: String!
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    avatar: String
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!

    users: [User!]!
    todos: [ToDo!]!
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!

    taskList: TaskList!
  }

`;



// Resolvers define the technique for fetching the types defined in the
// schema. This resolver retrieves books from the "books" array above.
const resolvers = {

  Query: {
    myTaskLists: async (_, __, { db, user }) => {
      if (!user) { throw new Error ('Authentication Error. Please sing in'); }

      return await db.collection('TaskList')
                                .find({ userIds: user._id })
                                .toArray();
      
    },
    getTaskList: async (_, {id}, {db, user}) => {
      if (!user) { throw new Error ('Authentication Error. Please sing in'); }

      return await db.collection('TaskList').findOne({ _id: ObjectId(id) });

    }
  },


  Mutation: {
      signUp: async (_, { input }, { db }) => {
        const hashedPassword = bcrypt.hashSync(input.password);
        const user = {
          ...input,
          password: hashedPassword,
        }
        
        // save to database
        const result = await db.collection('Users').insertOne(user);
        

        return {
          user,
          token: getToken(user),
        }


      },

      signIn: async (_, { input }, { db }) => {
        const user = await db.collection('Users').findOne({ email: input.email })
        if(!user) {
          throw new Error('Invalid credentials!')
        }

        // check if password is correct
        const isPasswordCorrect = bcrypt.compareSync(input.password, user.password);
        if(!isPasswordCorrect){
          throw new Error('Invalid credentials!')
        }
        return {
          user,
          token: getToken(user),
        }
      },

      createTaskList: async (_, { title }, { db, user }) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        const newTaskList = {
          title, 
          createdAt: new Date().toISOString(),

          userIds: [user._id] // the user who created the TaskList
        }
        const result = await db.collection('TaskList').insertOne(newTaskList);
        return newTaskList;

      },

      updateTaskList: async (_, { id, title }, { db, user }) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        const result = await db.collection('TaskList').updateOne({ 
                              _id: ObjectId(id)
                              }, {
                                $set: {
                                  title
                                }
                              })

      return await db.collection('TaskList').findOne({ _id: ObjectId(id) } );
      },

      addUserToTaskList: async (_, { taskListId, userId }, { db, user }) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        const taskList = await db.collection('TaskList').findOne({ _id: ObjectId(taskListId) } )

        if (!taskList) {
          return null;
        }
        if (taskList.userIds.find(dbId => dbId.toString() === userId.toString())) {
          throw new Error('User already exists in this TaskList!')
          return taskList;
        }


        await db.collection('TaskList')
                .updateOne({ 
                  _id: ObjectId(taskListId)
                }, {
                  $push: {
                  userIds: ObjectId(userId)
                  }
                })
        taskList.userIds.push(ObjectId(userId))
      return taskList;
      },

      deleteTaskList: async (_, {id}, {db, user}) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        await db.collection('TaskList').remove({ _id: ObjectId(id) });

        return true;
      },

      createToDo: async (_, { content, taskListId }, { db, user }) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        const newToDo = {
          content, 
          taskListId: ObjectId(taskListId),
          isCompleted: false,
        }
        const result = await db.collection('ToDo').insertOne(newToDo);
        return newToDo;

      },

      updateToDo: async (_, data, { db, user }) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        const result = await db.collection('ToDo')
                              .updateOne({ 
                                _id: ObjectId(data.id)
                              }, {
                                $set: data
                              })

      return await db.collection('ToDo').findOne({ _id: ObjectId(data.id) } );
      },

      deleteToDo: async (_, { id }, {db, user}) => {
        if (!user) { throw new Error ('Authentication Error. Please sing in'); }

        await db.collection('ToDo').remove({ _id: ObjectId(id) });

        return true;
      },
    },
              
    User: {
      id: ({ _id, id }) => _id || id    // takes either _id or id 
    },

    TaskList: {
      id: ({ _id, id }) => _id || id,    // takes either _id or id
      progress: async ({ _id }, _, { db }) => {
        const todos = await db.collection('ToDo').find({ taskListId: ObjectId(_id) }).toArray()
        const completed = todos.filter(todos => todos.isCompleted);

        if(todos.length === 0) {
          return 0;
        }

        return 100 * completed.length / todos.length;
      },
      users: async ({ userIds },_ , { db }) => 
        Promise.all(userIds.map((userId) => db.collection('Users').findOne({ _id: userId }))
        ),
      todos: async ({ _id }, _, { db }) => (
        await db.collection('ToDo').find({ taskListId: ObjectId(_id) }).toArray()
      )
    },

    ToDo: {
      id: ({ _id, id }) => _id || id,    // takes either _id or id
      taskList: async ({ taskListId }, _, { db }) => await db.collection('TaskList').findOne({ _id: ObjectId(taskListId)})
    },
  };


  const start = async () => {
    const client = new MongoClient(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db(DB_NAME);
    
    const context = {
      db,
    }

  
    // The ApolloServer constructor requires two parameters: your schema
    // definition and your set of resolvers.
    const server = new ApolloServer({ 
      typeDefs, 
      resolvers, 
      context: async ( {req} ) => {
        const user = await getUserFromToken(req.headers.authorization, db);
        return {
          db,
          user,
        }
      } 
    
    });




  
    // The `listen` method launches a web server.
    server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
    });
  }

  start();

  
